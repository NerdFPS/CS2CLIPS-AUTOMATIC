#!/usr/bin/env node
// Varre uma pasta grande de clipes (ex.: Medal) e lista os que têm N+ kills do próprio jogador
// (moldura vermelha no killfeed). Rápido o bastante para centenas de clipes; resultado é uma
// triagem — confira os escolhidos com analyze-clips.mjs.
// Uso: node find-multikills.mjs <pasta> [--min 3] [--recent 200] [--jobs 4] [--out multikills.json]
import path from 'node:path';
import fs from 'node:fs';
import * as L from './lib.mjs';
import { DEFAULT_STYLE } from './defaults.mjs';

const { pos, opt } = L.parseArgs(process.argv.slice(2));
if (!pos[0]) { console.error('uso: node find-multikills.mjs <pasta> [--min 3] [--recent 200] [--jobs 4] [--out arquivo.json]'); process.exit(1); }
await L.checkTools();
const min = Number(opt.min || 3), jobs = Number(opt.jobs || 4);
// <pasta> ou um .json com a lista (ex.: saída de medal-titles.mjs: [{file}, ...])
const src = pos[0].toLowerCase().endsWith('.json') ? L.readJson(pos[0]).map((x) => (typeof x === 'string' ? x : x.file)) : L.listVideos(pos[0]);
let files = src.map((f) => ({ f, m: fs.statSync(f).mtimeMs })).sort((a, b) => b.m - a.m).map((x) => x.f);
if (opt.recent) files = files.slice(0, Number(opt.recent));
const out = path.resolve(opt.out || 'multikills.json');
const kf = DEFAULT_STYLE.output.killfeed;

// Retoma de onde parou se o arquivo já existir.
const done = fs.existsSync(out) ? L.readJson(out).results : [];
const seen = new Set(done.map((r) => r.file));
const queue = files.filter((f) => !seen.has(f));
console.log(`${files.length} clipes, ${queue.length} a analisar (${jobs} em paralelo)...`);

let n = 0;
const save = () => L.writeJson(out, { min, results: done.sort((a, b) => b.kills.length - a.kills.length || b.mtime - a.mtime) });
async function worker() {
  while (queue.length) {
    const f = queue.shift();
    let r;
    try {
      const info = await L.probe(f);
      const { kills } = await L.redKillfeedKills(f, kf, 8);
      r = { file: f, mtime: fs.statSync(f).mtimeMs, duration: +info.duration.toFixed(1), kills };
    } catch (e) { r = { file: f, mtime: 0, duration: 0, kills: [], error: String(e.message || e).slice(0, 200) }; }
    done.push(r);
    if (++n % 10 === 0) { save(); console.log(`  ${n}/${seen.size + n > files.length ? files.length : n} ...`); }
  }
}
await Promise.all(Array.from({ length: jobs }, worker));
save();
const hits = done.filter((r) => r.kills.length >= min);
console.log(`\n${hits.length} clipes com ${min}+ kills (triagem — confira):`);
for (const h of hits) console.log(`  ${h.kills.length}K  ${path.basename(h.file)}  [${h.kills.join(', ')}]`);
console.log(`\nResultado: ${out}`);
