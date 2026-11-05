#!/usr/bin/env node
// Analisa vários vídeos de referência (ex.: os últimos 20 de um canal) e junta as estatísticas de edição
// num resumo único, mais folhas de amostra (início e meio de alguns vídeos) para inspeção visual.
//   node analyze-channel.mjs <pasta com .mp4> [--jobs 3] [--samples 4]
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as L from './lib.mjs';

const { pos, opt } = L.parseArgs(process.argv.slice(2));
if (!pos[0]) { console.error('uso: node analyze-channel.mjs <pasta> [--jobs 3] [--samples 4]'); process.exit(1); }
await L.checkTools();
const dir = path.resolve(pos[0]);
const files = L.listVideos(dir);
const outDir = path.join(dir, '_analise');
fs.mkdirSync(outDir, { recursive: true });
const here = path.dirname(fileURLToPath(import.meta.url));
const titles = fs.existsSync(path.join(dir, 'videos.json')) ? Object.fromEntries(L.readJson(path.join(dir, 'videos.json')).map((v) => [v.id, v.title])) : {};

// 1) analyze-reference em cada vídeo (pula os já feitos)
const queue = [...files];
await Promise.all(Array.from({ length: Number(opt.jobs || 3) }, async () => {
  while (queue.length) {
    const f = queue.shift();
    const id = path.basename(f, path.extname(f));
    const res = path.join(outDir, id, 'reference-analysis.json');
    if (fs.existsSync(res)) continue;
    const r = await L.run(process.execPath, [path.join(here, 'analyze-reference.mjs'), f, path.join(outDir, id)]);
    console.log(`${r.code === 0 ? '✔' : '✗'} ${id} ${titles[id] || ''}`);
  }
}));

// 2) Agregado
const rows = [];
for (const f of files) {
  const id = path.basename(f, path.extname(f));
  const p = path.join(outDir, id, 'reference-analysis.json');
  if (!fs.existsSync(p)) continue;
  const r = L.readJson(p);
  rows.push({
    id, title: titles[id] || '', minutes: +(r.info.duration / 60).toFixed(1),
    cutsPerMinute: r.shots.cutsPerMinute, medianShot: r.shots.median, meanShot: r.shots.mean,
    shortShotsPct: Math.round((r.shots.durations.filter((x) => x < 1).length / r.shots.count) * 100),
    cutsOnBeat: r.music?.cutsOnBeatRatio ?? null, bpm: r.music?.bpm ?? null,
    flashesPerMin: +(r.flashes.length / (r.info.duration / 60)).toFixed(1),
    saturation: r.look.saturationAvg, brightness: r.look.brightnessAvg, contrast: r.look.contrastAvg,
  });
}
const avg = (k) => +(L.mean(rows.map((x) => x[k]).filter((v) => v !== null && Number.isFinite(v)))).toFixed(2);
const med = (k) => +(L.median(rows.map((x) => x[k]).filter((v) => v !== null && Number.isFinite(v)))).toFixed(2);
const summary = {
  videos: rows.length,
  cutsPerMinute: { mean: avg('cutsPerMinute'), median: med('cutsPerMinute') },
  shotSeconds: { median: med('medianShot'), mean: avg('meanShot') },
  shortShotsPct: avg('shortShotsPct'),
  cutsOnBeat: avg('cutsOnBeat'),
  flashesPerMin: avg('flashesPerMin'),
  look: { saturation: avg('saturation'), brightness: avg('brightness'), contrast: avg('contrast') },
  hints: [],
};
const H = summary.hints;
H.push(summary.cutsOnBeat >= 0.5 ? 'Corta no beat → pacing.beatSync: true.' : `Só ${Math.round(summary.cutsOnBeat * 100)}% dos cortes no beat (≈ acaso) → corta pela jogada: pacing.beatSync: false, música mais baixa.`);
H.push(`Plano mediano ${summary.shotSeconds.median}s → preRoll+postRoll ≈ ${(summary.shotSeconds.median * 0.9).toFixed(1)}s por kill.`);
if (summary.shortShotsPct > 15) H.push(`${summary.shortShotsPct}% de planos < 1 s: confira se são inserções reais ou mira de AWP/replay (falsos cortes).`);
if (summary.flashesPerMin > 1) H.push(`~${summary.flashesPerMin} flashes/min: confira nas imagens se são transições, replays ou só tiros/explosões.`);
L.writeJson(path.join(outDir, 'channel-summary.json'), { summary, videos: rows });

// 3) Amostras visuais: início (30 s) e meio (60 s) de alguns vídeos, 2 quadros/s, com tempo carimbado
const nS = Math.min(Number(opt.samples || 4), rows.length);
const sampDir = path.join(outDir, '_amostras');
fs.mkdirSync(sampDir, { recursive: true });
L.ensureFont(sampDir, null);
const pick = Array.from({ length: nS }, (_, k) => rows[Math.round((k * (rows.length - 1)) / Math.max(1, nS - 1))]);
for (const r of pick) {
  const f = files.find((x) => path.basename(x, path.extname(x)) === r.id);
  const mid = Math.max(0, r.minutes * 30 - 30);
  for (const [tag, ss, t] of [['inicio', 0, 30], ['meio', mid, 60]]) {
    const vf = `fps=${tag === 'inicio' ? 2 : 1},scale=320:-2,drawtext=fontfile=font.ttf:text='%{pts\\:hms}':x=4:y=4:fontsize=16:fontcolor=yellow:box=1:boxcolor=black@0.7,tile=6x10:padding=3`;
    await L.ffmpeg(['-ss', String(ss), '-t', String(t), '-i', f, '-an', '-vf', vf, '-frames:v', '1', '-y', path.join(sampDir, `${r.id}_${tag}.jpg`)], { cwd: sampDir, allowFail: true });
  }
}

console.log('\n=== Resumo do canal ===');
for (const x of rows) console.log(`${x.id.padEnd(12)} ${String(x.minutes).padStart(5)}min  ${String(x.cutsPerMinute).padStart(5)} cortes/min  plano ${x.medianShot}s  beat ${x.cutsOnBeat}  flash/min ${x.flashesPerMin}`);
console.log(`\nMÉDIA (${rows.length}): ${summary.cutsPerMinute.mean} cortes/min · plano mediano ${summary.shotSeconds.median}s · ${Math.round(summary.cutsOnBeat * 100)}% no beat · ${summary.flashesPerMin} flashes/min · saturação ${summary.look.saturation}`);
for (const h of summary.hints) console.log(`• ${h}`);
console.log(`\nResumo: ${path.join(outDir, 'channel-summary.json')}\nAmostras para olhar: ${sampDir}`);
