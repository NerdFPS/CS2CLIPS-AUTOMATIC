#!/usr/bin/env node
// Baixa referências com yt-dlp: um vídeo (YouTube, Instagram Reel, TikTok, X...) ou os últimos N
// vídeos de um canal. Resolução baixa basta para análise de estilo.
//   node fetch-reference.mjs <url> [--out modelo] [--name referencia]
//   node fetch-reference.mjs https://youtube.com/@canal --last 20 [--out refs/canal] [--height 360] [--shorts]
import path from 'node:path';
import fs from 'node:fs';
import * as L from './lib.mjs';

const { pos, opt } = L.parseArgs(process.argv.slice(2));
const url = pos[0];
if (!url) { console.error('uso: node fetch-reference.mjs <url de vídeo ou canal> [--last 20] [--out pasta] [--height 360] [--name nome] [--shorts]'); process.exit(1); }
await L.checkTools();
await L.checkYtdlp();
const Y = L.ytdlpPath();
const out = path.resolve(opt.out || 'referencias');
fs.mkdirSync(out, { recursive: true });
const h = Number(opt.height || 360);
const fmt = `bv*[height<=${h}][ext=mp4]+ba[ext=m4a]/b[height<=${h}]/bv*+ba/b`;
const base = ['--no-warnings', '--no-playlist', ...(L.FFMPEG_DIR ? ['--ffmpeg-location', L.FFMPEG_DIR] : []), '-f', fmt, '--merge-output-format', 'mp4'];

const isChannel = /youtube\.com\/(@|c\/|channel\/|user\/)/i.test(url) && !/watch\?|shorts\//i.test(url);
if (!isChannel) {
  const name = opt.name || 'referencia';
  const r = await L.run(Y, [...base, '-o', path.join(out, `${name}.%(ext)s`), url]);
  if (r.code !== 0) { console.error(`Falhou: ${r.stderr.split('\n').slice(-5).join('\n')}\nSe for Instagram privado/bloqueado, abra o link no navegador e baixe o MP4 do "video_versions" da página.`); process.exit(1); }
  console.log(`✔ ${path.join(out, name + '.mp4')}`);
  process.exit(0);
}

// Canal: lista os últimos N (aba Vídeos; --shorts para a aba Shorts) e baixa em paralelo.
const last = Number(opt.last || 20);
const tab = url.replace(/\/(videos|shorts|streams|featured)\/?$/, '').replace(/\?.*$/, '') + (opt.shorts ? '/shorts' : '/videos');
const list = await L.run(Y, ['--encoding', 'utf-8', '--flat-playlist', '--playlist-end', String(last), '--print', '%(id)s\t%(title)s\t%(duration)s', tab]);
const items = list.stdout.trim().split(/\r?\n/).filter(Boolean).map((l) => { const [id, title, dur] = l.split('\t'); return { id, title, duration: Number(dur) || null }; });
if (!items.length) { console.error(`Nenhum vídeo listado em ${tab}.\n${list.stderr.slice(-400)}`); process.exit(1); }
L.writeJson(path.join(out, 'videos.json'), items);
console.log(`${items.length} vídeos de ${tab}. Baixando em ${h}p...`);
const queue = [...items];
await Promise.all(Array.from({ length: Number(opt.jobs || 4) }, async () => {
  while (queue.length) {
    const it = queue.shift();
    const file = path.join(out, `${it.id}.mp4`);
    if (fs.existsSync(file)) continue;
    const r = await L.run(Y, [...base, '-o', path.join(out, '%(id)s.%(ext)s'), `https://www.youtube.com/watch?v=${it.id}`]);
    console.log(`${r.code === 0 ? '✔' : '✗'} ${it.id}  ${it.title}`);
  }
}));
console.log(`\nPasta: ${out}\nPróximo passo: node analyze-channel.mjs "${out}"`);
