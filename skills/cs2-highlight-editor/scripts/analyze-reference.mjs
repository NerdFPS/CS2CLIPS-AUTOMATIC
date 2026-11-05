#!/usr/bin/env node
// Analisa o vídeo de referência (o "modelo"): ritmo de cortes, BPM, alinhamento corte/beat,
// flashes, cor média, e gera folhas de contato + quadros por plano para inspeção visual.
// Uso: node analyze-reference.mjs <referencia.mp4> [pasta_saida]
import path from 'node:path';
import fs from 'node:fs';
import * as L from './lib.mjs';

const { pos } = L.parseArgs(process.argv.slice(2));
const ref = pos[0] && path.resolve(pos[0]);
if (!ref || !fs.existsSync(ref)) { console.error('uso: node analyze-reference.mjs <referencia.mp4> [pasta_saida]'); process.exit(1); }
await L.checkTools();

const out = path.resolve(pos[1] || path.join(path.dirname(ref), '_analise_referencia'));
const framesDir = path.join(out, 'frames');
fs.mkdirSync(framesDir, { recursive: true });
L.ensureFont(out, null);

const info = await L.probe(ref);
console.log(`Referência: ${info.width}x${info.height} @ ${info.fps.toFixed(2)} fps, ${info.duration.toFixed(1)} s`);

// 1) Cortes
console.log('Detectando cortes...');
const sc = await L.sceneScores(ref, 0.3);
const rawCuts = [];
for (const s of sc) if (s.t > 0.05 && (!rawCuts.length || s.t - rawCuts[rawCuts.length - 1] > 0.12)) rawCuts.push(+s.t.toFixed(3));

// 2) Luz/cor por quadro → flashes e "look"
console.log('Medindo brilho/saturação (flashes e cor)...');
const st = (await L.signalStats(ref, 30)).filter((f) => Number.isFinite(f.y));
// Flash = clareia muito e volta perto do nível anterior em até ~0,3 s (um corte para cena clara não volta).
const flashes = [];
for (let i = 5; i < st.length; i++) {
  const prev = L.median(st.slice(i - 5, i).map((f) => f.y));
  if (st[i].y - prev <= 35) continue;
  const back = st.slice(i + 1, i + 10).some((f) => f.y - prev < 15);
  if (back && (!flashes.length || st[i].t - flashes[flashes.length - 1].t > 0.2)) {
    let j = i; while (j + 1 < st.length && st[j + 1].y - prev >= 15) j++;
    flashes.push({ t: +st[i].t.toFixed(2), end: +(st[j].t + 1 / 30).toFixed(2) });
  }
}
// Cortes causados pelo próprio flash não são cortes de plano.
const cuts = rawCuts.filter((c) => !flashes.some((fl) => c >= fl.t - 0.07 && c <= fl.end + 0.07));
const bounds = [0, ...cuts, info.duration];
const shotDur = bounds.slice(1).map((b, i) => +(b - bounds[i]).toFixed(3));
const look = {
  brightnessAvg: +L.mean(st.map((f) => f.y)).toFixed(1),
  saturationAvg: +L.mean(st.map((f) => f.sat)).toFixed(1),
  contrastAvg: +L.mean(st.map((f) => f.hi - f.lo)).toFixed(1),
  note: 'Compare com os mesmos campos em clips-analysis.json para calibrar color.saturation/contrast.',
};

// 3) Música / beats
let music = null;
if (info.hasAudio) {
  console.log('Analisando música (BPM e beats)...');
  const mb = await L.musicBeats(ref);
  const bt = mb.beats.map((b) => b.t);
  const period = mb.bpm ? 60 / mb.bpm : 0;
  const near = (t) => bt.reduce((best, b) => (Math.abs(b - t) < Math.abs(best) ? b - t : best), Infinity);
  const dists = cuts.map((c) => near(c));
  const onBeat = dists.filter((d) => Math.abs(d) <= 0.07).length;
  music = {
    bpm: mb.bpm,
    beatPeriod: +period.toFixed(3),
    beatCount: bt.length,
    cutsOnBeatRatio: cuts.length ? +(onBeat / cuts.length).toFixed(2) : 0,
    medianBeatsPerShot: period ? +(L.median(shotDur) / period).toFixed(2) : null,
    firstBeats: bt.slice(0, 64),
  };
}

// 4) Folhas de contato (visão geral) e quadro do meio de cada plano
console.log('Gerando folhas de contato e quadros...');
const cols = 6, rows = 6;
const sheetFps = Math.min(4, (cols * rows * 4) / Math.max(1, info.duration));
const labeled = await L.contactSheet(ref, path.join(framesDir, 'sheet_%02d.jpg'), { fps: +sheetFps.toFixed(4), cols, rows, cwd: out });
const sheets = fs.readdirSync(framesDir).filter((f) => f.startsWith('sheet_')).sort().map((f) => path.join(framesDir, f));

const maxShots = 30;
const pick = shotDur.length <= maxShots ? shotDur.map((_, i) => i)
  : Array.from({ length: maxShots }, (_, k) => Math.round((k * (shotDur.length - 1)) / (maxShots - 1)));
const shotFrames = [];
for (const i of pick) {
  const t = bounds[i] + shotDur[i] / 2;
  const file = path.join(framesDir, `shot_${String(i).padStart(3, '0')}_${t.toFixed(2)}s.jpg`);
  await L.extractFrame(ref, t, file, 640);
  shotFrames.push({ shot: i, t: +t.toFixed(2), duration: shotDur[i], file });
}

const result = {
  file: ref,
  info,
  shots: {
    count: shotDur.length,
    cutsPerMinute: +((cuts.length / Math.max(1, info.duration)) * 60).toFixed(1),
    mean: +L.mean(shotDur).toFixed(2),
    median: +L.median(shotDur).toFixed(2),
    min: Math.min(...shotDur),
    max: Math.max(...shotDur),
    durations: shotDur,
  },
  cuts,
  music,
  flashes,
  look,
  sheets: { files: sheets, fps: +sheetFps.toFixed(4), cols, rows, timestamped: labeled,
    timeOfTile: 't = (sheetIndex*36 + row*6 + col) / fps  (sheetIndex começa em 0)' },
  shotFrames,
};
L.writeJson(path.join(out, 'reference-analysis.json'), result);

console.log('\n=== Resumo da referência ===');
console.log(`Planos: ${result.shots.count} | duração média ${result.shots.mean}s | mediana ${result.shots.median}s | ${result.shots.cutsPerMinute} cortes/min`);
if (music) console.log(`Música: ~${music.bpm} BPM | ${Math.round(music.cutsOnBeatRatio * 100)}% dos cortes no beat | ~${music.medianBeatsPerShot} beats por plano`);
console.log(`Flashes detectados: ${flashes.length}`);
console.log(`Look médio: brilho ${look.brightnessAvg}, saturação ${look.saturationAvg}, contraste ${look.contrastAvg}`);
console.log(`\nArquivos: ${path.join(out, 'reference-analysis.json')}`);
console.log(`Olhe as imagens em ${framesDir} (sheet_*.jpg primeiro, depois shot_*.jpg).`);
