#!/usr/bin/env node
// Música para o highlight. Por padrão busca no canal oficial NoCopyrightSounds (NCS): livre para usar
// no YouTube com crédito na descrição — evita bloqueio/monetização perdida.
//   node get-music.mjs --search "phonk"            # lista opções (NCS), sem baixar
//   node get-music.mjs --get <id ou url> [--out musicas] [--name faster]
//   node get-music.mjs --analyze musica.mp3        # BPM, drops e start sugerido
// Gêneros que combinam com CS2: phonk, brazilian phonk, funk, drift phonk, dubstep, trap, drum and bass.
import path from 'node:path';
import fs from 'node:fs';
import * as L from './lib.mjs';

const { opt } = L.parseArgs(process.argv.slice(2));
await L.checkTools();

async function analyze(file) {
  const [mb, prof] = await Promise.all([L.musicBeats(file), L.musicProfile(file)]);
  const bars = [];
  for (let i = 0; i < prof.energy.length; i += 8) bars.push(`${String(i * prof.step).padStart(4)}s ${'#'.repeat(Math.round(Math.max(...prof.energy.slice(i, i + 8)) * 20))}`);
  console.log(`\n${path.basename(file)} — ${mb.bpm} BPM, ${prof.duration.toFixed(0)} s`);
  console.log(bars.join('\n'));
  console.log(`Drops: ${prof.drops.map((d) => d.t + 's').join(', ') || 'nenhum claro'}`);
  console.log(`Sugestão: "music": { "file": "${path.basename(file)}", "start": "drop" }  (o 1º kill cai no drop em ${prof.drops[0]?.t ?? '?'}s)`);
  return { bpm: mb.bpm, duration: prof.duration, drops: prof.drops };
}

if (opt.analyze) { await analyze(path.resolve(opt.analyze)); process.exit(0); }

await L.checkYtdlp();
const Y = L.ytdlpPath();
if (opt.search) {
  const q = `NoCopyrightSounds ${opt.search} NCS Release`;
  const r = await L.run(Y, ['--encoding', 'utf-8', '--flat-playlist', '--print', '%(id)s\t%(channel)s\t%(title)s\t%(duration)s\t%(view_count)s', `ytsearch${opt.n || 15}:${q}`]);
  const rows = r.stdout.trim().split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'));
  const ncs = rows.filter((x) => x[1] === 'NoCopyrightSounds');
  console.log(`${ncs.length} faixas do canal oficial NCS para "${opt.search}" (views | duração | id):`);
  for (const [id, , title, dur, views] of ncs.sort((a, b) => Number(b[4]) - Number(a[4]))) console.log(`  ${String(Math.round(Number(views) / 1000) + 'k').padStart(7)} | ${String(dur).padStart(3)}s | ${id} | ${title}`);
  if (rows.length > ncs.length) console.log(`(${rows.length - ncs.length} resultados de outros canais foram ignorados: direitos incertos)`);
  process.exit(0);
}
if (opt.get) {
  const url = /^https?:/.test(opt.get) ? opt.get : `https://www.youtube.com/watch?v=${opt.get}`;
  const meta = await L.run(Y, ['--encoding', 'utf-8', '--print', '%(channel)s\t%(title)s', '--skip-download', url]);
  const [channel, title] = meta.stdout.trim().split('\t');
  if (channel !== 'NoCopyrightSounds' && !opt.force) {
    console.error(`"${title}" é do canal "${channel}", não do NCS: direitos incertos. Use --force só se o usuário confirmar que pode usar.`);
    process.exit(1);
  }
  const out = path.resolve(opt.out || 'musicas');
  fs.mkdirSync(out, { recursive: true });
  const name = opt.name || (title || 'musica').split('|')[0].replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').toLowerCase();
  const r = await L.run(Y, ['--no-warnings', ...(L.FFMPEG_DIR ? ['--ffmpeg-location', L.FFMPEG_DIR] : []), '-x', '--audio-format', 'mp3', '--audio-quality', '0', '-o', path.join(out, `${name}.%(ext)s`), url]);
  if (r.code !== 0) { console.error(r.stderr.slice(-600)); process.exit(1); }
  const file = path.join(out, `${name}.mp3`);
  const credit = (title || '').split('|')[0].trim() + ' [NCS Release]';
  fs.writeFileSync(path.join(out, `${name}.credito.txt`), `${credit}\nMusic provided by NoCopyrightSounds\n${url}\n`);
  console.log(`✔ ${file}\nCrédito (colocar na descrição do vídeo): ${credit} — Music provided by NoCopyrightSounds — ${url}`);
  await analyze(file);
  process.exit(0);
}
console.error('uso: --search "phonk" | --get <id/url> [--out pasta] [--name nome] | --analyze arquivo.mp3');
process.exit(1);
