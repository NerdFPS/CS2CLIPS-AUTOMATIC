#!/usr/bin/env node
// Estudo em lote de MUITAS referências (dezenas/centenas): uma passada rápida por vídeo, métricas de
// edição comparáveis, distribuição (percentis) e correlação de cada métrica com as views.
//   node analyze-batch.mjs <pasta com .mp4> [--jobs 4]
// Lê <pasta>/videos.json ([{id,title,views,channel}], gerado por fetch-reference ou à mão) se existir.
// Saída: <pasta>/_lote/batch.json, batch.csv, resumo impresso e mosaicos 3x3 (mosaic/<id>.jpg) +
// folhas com 12 vídeos cada (folhas/folha_NN.jpg) para revisão visual.
import path from 'node:path';
import fs from 'node:fs';
import * as L from './lib.mjs';

const { pos, opt } = L.parseArgs(process.argv.slice(2));
if (!pos[0]) { console.error('uso: node analyze-batch.mjs <pasta> [--jobs 4]'); process.exit(1); }
await L.checkTools();
const dir = path.resolve(pos[0]);
const out = path.join(dir, '_lote');
const mos = path.join(out, 'mosaic');
fs.mkdirSync(mos, { recursive: true });
const meta = fs.existsSync(path.join(dir, 'videos.json')) ? Object.fromEntries(L.readJson(path.join(dir, 'videos.json')).map((v) => [v.id, v])) : {};
const cacheF = path.join(out, 'batch.json');
const cache = fs.existsSync(cacheF) ? Object.fromEntries(L.readJson(cacheF).videos.map((v) => [v.id, v])) : {};
const files = L.listVideos(dir);
const FPS = 15;

async function analyzeOne(file) {
  const id = path.basename(file, path.extname(file));
  const info = await L.probe(file);
  const D = info.duration;
  // 1 passada: brilho/saturação/contraste + score de mudança de cena em TODO quadro (15 fps, 160 px)
  const r = await L.ffmpeg(['-i', file, '-an', '-vf', `fps=${FPS},scale=160:-2,signalstats,select='gte(scene,0)',metadata=print`, '-f', 'null', '-'], { keepStderr: true, allowFail: true });
  const fr = L.parseMetadata(r.stderr).filter((f) => Number.isFinite(f['lavfi.signalstats.YAVG']));
  const y = fr.map((f) => f['lavfi.signalstats.YAVG']), sat = fr.map((f) => f['lavfi.signalstats.SATAVG']);
  const con = fr.map((f) => f['lavfi.signalstats.YHIGH'] - f['lavfi.signalstats.YLOW']);
  const sc = fr.map((f) => f['lavfi.scene_score'] ?? 0);
  const ts = fr.map((f) => f.t);
  // flashes: sobe muito e volta em ~0,3 s
  const flashes = [];
  for (let i = 3; i < y.length - 1; i++) {
    const prev = L.median(y.slice(Math.max(0, i - 3), i));
    if (y[i] - prev > 35 && y.slice(i + 1, i + 5).some((v) => v - prev < 15) && (!flashes.length || ts[i] - flashes.at(-1) > 0.25)) flashes.push(ts[i]);
  }
  // cortes: score alto, fora de flash
  const cuts = [];
  for (let i = 1; i < sc.length; i++) if (sc[i] > 0.3 && !flashes.some((f) => Math.abs(f - ts[i]) < 0.15) && (!cuts.length || ts[i] - cuts.at(-1) > 0.12)) cuts.push(ts[i]);
  const bounds = [0, ...cuts, D], shots = bounds.slice(1).map((b, i) => b - bounds[i]);
  // movimento: mediana do score de cena entre cortes (giros/flicks = alto)
  const motion = L.median(sc.filter((v) => v < 0.3));
  // preto no começo/fim
  let blackStart = 0; for (let i = 0; i < y.length && y[i] < 18; i++) blackStart = ts[i] + 1 / FPS;
  let blackEnd = 0; for (let i = y.length - 1; i >= 0 && y[i] < 18; i--) blackEnd = D - ts[i];
  const fadeOut = y.length > FPS * 2 ? L.mean(y.slice(-FPS)) < 0.5 * L.mean(y.slice(-FPS * 3, -FPS)) : false;
  // ritmo por terço (arco)
  const third = (a, b) => cuts.filter((c) => c >= a && c < b).length / Math.max(0.1, (b - a) / 60);
  const cpmThirds = [third(0, D / 3), third(D / 3, 2 * D / 3), third(2 * D / 3, D)].map((v) => +v.toFixed(1));
  // barras de cinema (letterbox): cropdetect a 1 fps
  const cr = await L.ffmpeg(['-i', file, '-an', '-vf', 'fps=1,cropdetect=limit=24:round=2:reset=1', '-f', 'null', '-'], { keepStderr: true, allowFail: true });
  const hs = [...cr.stderr.matchAll(/crop=\d+:(\d+):\d+:\d+/g)].map((m) => +m[1]);
  const letterboxPct = hs.length ? Math.round((hs.filter((h) => h < info.height * 0.9).length / hs.length) * 100) : 0;
  // música: BPM e cortes no beat
  let bpm = null, onBeat = null;
  if (info.hasAudio) {
    const mb = await L.musicBeats(file);
    bpm = mb.bpm || null;
    const bt = mb.beats.map((b) => b.t);
    if (bt.length && cuts.length) onBeat = +(cuts.filter((c) => bt.some((b) => Math.abs(b - c) <= 0.07)).length / cuts.length).toFixed(2);
  }
  // mosaico 3x3 para revisão visual
  const mf = path.join(mos, `${id}.jpg`);
  if (!fs.existsSync(mf)) await L.ffmpeg(['-i', file, '-an', '-vf', `fps=9/${Math.max(1, D).toFixed(2)},scale=200:-2,tile=3x3:padding=2`, '-frames:v', '1', '-q:v', '4', '-y', mf], { allowFail: true });
  const m = meta[id] || {};
  return {
    id, title: m.title || '', channel: m.channel || '', views: m.views ?? null,
    duration: +D.toFixed(1), vertical: info.height > info.width,
    cutsPerMin: +((cuts.length / D) * 60).toFixed(1), shotMedian: +L.median(shots).toFixed(2), shotMean: +L.mean(shots).toFixed(2),
    shortShotsPct: Math.round((shots.filter((s) => s < 1).length / shots.length) * 100), longShotsPct: Math.round((shots.filter((s) => s > 4).length / shots.length) * 100),
    cpmThirds, firstCut: cuts.length ? +cuts[0].toFixed(2) : null,
    flashesPerMin: +((flashes.length / D) * 60).toFixed(1), motion: +motion.toFixed(4),
    saturation: +L.mean(sat).toFixed(1), brightness: +L.mean(y).toFixed(1), contrast: +L.mean(con).toFixed(1),
    letterboxPct, blackStart: +blackStart.toFixed(2), blackEnd: +blackEnd.toFixed(2), fadeOut,
    bpm, cutsOnBeat: onBeat,
  };
}

const queue = files.filter((f) => !cache[path.basename(f, path.extname(f))]);
console.log(`${files.length} vídeos (${files.length - queue.length} já analisados). Analisando ${queue.length}...`);
let done = 0;
await Promise.all(Array.from({ length: Number(opt.jobs || 4) }, async () => {
  while (queue.length) {
    const f = queue.shift();
    try { const r = await analyzeOne(f); cache[r.id] = r; } catch (e) { console.warn(`✗ ${path.basename(f)}: ${String(e.message).slice(0, 120)}`); }
    if (++done % 10 === 0) { console.log(`  ${done} feitos`); L.writeJson(cacheF, { videos: Object.values(cache) }); }
  }
}));
const V = Object.values(cache);
L.writeJson(cacheF, { videos: V });

// Distribuição e correlação com views (Spearman, só com views conhecidas)
const keys = ['duration', 'cutsPerMin', 'shotMedian', 'shortShotsPct', 'longShotsPct', 'flashesPerMin', 'motion', 'saturation', 'brightness', 'contrast', 'letterboxPct', 'blackStart', 'firstCut', 'bpm', 'cutsOnBeat'];
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };
const rank = (a) => { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = Array(a.length); idx.forEach(([, i], k) => { r[i] = k; }); return r; };
const spearman = (a, b) => { const ra = rank(a), rb = rank(b), n = a.length, ma = L.mean(ra), mb = L.mean(rb); let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; } return num / Math.sqrt(da * db || 1); };
const stats = {};
for (const k of keys) {
  const vals = V.map((v) => v[k]).filter((x) => x !== null && Number.isFinite(x));
  const withViews = V.filter((v) => v.views && v[k] !== null && Number.isFinite(v[k]));
  stats[k] = { n: vals.length, p10: pct(vals, 0.1), p50: pct(vals, 0.5), p90: pct(vals, 0.9), mean: +L.mean(vals).toFixed(2),
    corrViews: withViews.length > 10 ? +spearman(withViews.map((v) => v[k]), withViews.map((v) => Math.log10(v.views))).toFixed(2) : null };
}
const top = [...V].filter((v) => v.views).sort((a, b) => b.views - a.views);
const q = Math.max(5, Math.floor(top.length / 4));
const cmp = Object.fromEntries(keys.map((k) => [k, { topQuartil: +L.median(top.slice(0, q).map((v) => v[k]).filter(Number.isFinite)).toFixed(2), bottomQuartil: +L.median(top.slice(-q).map((v) => v[k]).filter(Number.isFinite)).toFixed(2) }]));
const share = (fn) => Math.round((V.filter(fn).length / V.length) * 100);
const extra = { vertical: share((v) => v.vertical), letterboxAny: share((v) => v.letterboxPct > 15), startsBlack: share((v) => v.blackStart > 0.3), endsFade: share((v) => v.fadeOut || v.blackEnd > 0.5),
  arcAccelerates: share((v) => v.cpmThirds[2] > v.cpmThirds[0] * 1.15), arcSlowsDown: share((v) => v.cpmThirds[2] < v.cpmThirds[0] * 0.85) };
L.writeJson(path.join(out, 'summary.json'), { n: V.length, stats, topVsBottom: cmp, sharesPct: extra });
fs.writeFileSync(path.join(out, 'batch.csv'), [['id', ...keys, 'views', 'title'].join(';'), ...V.map((v) => [v.id, ...keys.map((k) => v[k]), v.views, `"${(v.title || '').replace(/"/g, "'")}"`].join(';'))].join('\n'));

// Folhas de revisão: 12 mosaicos por imagem, ordenados por views
const fol = path.join(out, 'folhas');
fs.mkdirSync(fol, { recursive: true });
const ord = [...V].sort((a, b) => (b.views || 0) - (a.views || 0)).map((v) => path.join(mos, `${v.id}.jpg`)).filter((f) => fs.existsSync(f));
for (let i = 0; i < ord.length; i += 12) {
  const part = ord.slice(i, i + 12);
  const outF = path.join(fol, `folha_${String(i / 12 + 1).padStart(2, '0')}.jpg`);
  if (fs.existsSync(outF)) continue;
  const layout = part.map((_, k) => `${(k % 4) === 0 ? '0' : Array.from({ length: k % 4 }, () => 'w0').join('+')}_${Math.floor(k / 4) === 0 ? '0' : Array.from({ length: Math.floor(k / 4) }, () => 'h0').join('+')}`).join('|');
  await L.ffmpeg(['-y', ...part.flatMap((f) => ['-i', f]), '-filter_complex', `${part.map((_, k) => `[${k}:v]scale=606:-2,setsar=1[m${k}]`).join(';')};${part.map((_, k) => `[m${k}]`).join('')}xstack=inputs=${part.length}:layout=${layout}:fill=black`, '-frames:v', '1', '-q:v', '4', outF], { allowFail: true });
}

console.log(`\n=== ${V.length} referências ===`);
console.log('métrica            p10    mediana   p90   | top25% views  bottom25%  | corr. c/ views');
for (const k of keys) { const s = stats[k]; console.log(`${k.padEnd(16)} ${String(s.p10).padStart(6)} ${String(s.p50).padStart(8)} ${String(s.p90).padStart(7)}   | ${String(cmp[k].topQuartil).padStart(10)} ${String(cmp[k].bottomQuartil).padStart(10)}  | ${s.corrViews ?? '-'}`); }
console.log(`\n% dos vídeos: vertical ${extra.vertical}% · barras de cinema ${extra.letterboxAny}% · começa no preto ${extra.startsBlack}% · termina em fade/preto ${extra.endsFade}% · acelera no fim ${extra.arcAccelerates}% · desacelera no fim ${extra.arcSlowsDown}%`);
console.log(`\nArquivos: ${out} (summary.json, batch.csv, folhas/ para revisão visual)`);
