#!/usr/bin/env node
// Calibra os pesos da nota viral com as views reais dos clipes postados.
//   node calibrate.mjs --set <vod>:<rank> --views 12345 [--platform tiktok|shorts|reels]   (anota o resultado de um clipe)
//   node calibrate.mjs                 (mostra a correlação de cada sinal com as views)
//   node calibrate.mjs --apply         (grava os pesos sugeridos em config.json; precisa de ≥ 15 clipes com views)
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, saveConfig, parseArgs } from './lib.mjs';

const { opt } = parseArgs(process.argv.slice(2));
const cfg = loadConfig();
const F = path.join(cfg.dataDir, 'calibracao.jsonl');
if (!fs.existsSync(F)) { console.log('Ainda não há clipes registrados (rode report.mjs depois de gerar clipes).'); process.exit(0); }
const rows = fs.readFileSync(F, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

if (opt.set) {
  const [vod, rank] = String(opt.set).split(':');
  const r = rows.filter((x) => String(x.vod) === vod && String(x.rank) === rank);
  if (!r.length) { console.error(`clipe ${opt.set} não está em ${F}`); process.exit(1); }
  for (const x of r) Object.assign(x, { views: Number(opt.views), platform: opt.platform || x.platform, posted: x.posted || new Date().toISOString().slice(0, 10) });
  fs.writeFileSync(F, rows.map((x) => JSON.stringify(x)).join('\n') + '\n');
  console.log(`ok: ${opt.set} = ${opt.views} views`);
  process.exit(0);
}

const R = rows.filter((x) => x.views > 0);
console.log(`${rows.length} clipes registrados, ${R.length} com views.`);
if (R.length < 5) { console.log('Poucos dados: anote as views de pelo menos 5 clipes (ideal 15+) com --set.'); process.exit(0); }
const rank = (a) => { const s = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = new Array(a.length); s.forEach(([, i], k) => (r[i] = k)); return r; };
const spearman = (a, b) => { const ra = rank(a), rb = rank(b), n = a.length, ma = (n - 1) / 2; let s = 0, sa = 0, sb = 0; for (let i = 0; i < n; i++) { s += (ra[i] - ma) * (rb[i] - ma); sa += (ra[i] - ma) ** 2; sb += (rb[i] - ma) ** 2; } return sa && sb ? s / Math.sqrt(sa * sb) : 0; };
const v = R.map((x) => Math.log10(x.views));
console.log(`nota × views (Spearman): ${spearman(R.map((x) => x.score), v).toFixed(2)}`);
const W = cfg.weights, sug = {};
for (const k of Object.keys(W)) {
  const has = R.filter((x) => x.components?.[k] != null);
  const r = has.length >= 5 ? spearman(has.map((x) => x.components[k]), has.map((x) => Math.log10(x.views))) : 0;
  sug[k] = Math.max(0.03, 0.5 * W[k] + 0.5 * Math.max(0, r) * W[k] * 3);
  console.log(`  ${k.padEnd(9)} correlação ${r.toFixed(2)} (n=${has.length})  peso ${W[k].toFixed(2)} → ${sug[k].toFixed(2)}`);
}
const tot = Object.values(sug).reduce((a, b) => a + b, 0);
for (const k of Object.keys(sug)) sug[k] = +(sug[k] / tot).toFixed(3);
console.log('Pesos sugeridos (normalizados):', sug);
if (opt.apply) {
  if (R.length < 15) { console.log('Não apliquei: precisa de pelo menos 15 clipes com views para não ajustar ao acaso.'); process.exit(0); }
  saveConfig({ weights: sug });
  console.log('Pesos gravados em config.json.');
}
