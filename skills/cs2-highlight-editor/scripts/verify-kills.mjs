#!/usr/bin/env node
// Gera uma tira de imagens do killfeed em volta de cada kill do kills.json (−1 s a +1,5 s), uma linha
// por kill, para conferir de uma vez se cada tempo é mesmo um kill seu (linha nova com moldura vermelha).
// Também avisa dos suspeitos: kill muito perto do fim do clipe (costuma ser a SUA morte/tela vermelha)
// ou kills a menos de 0,3 s um do outro.
//   node verify-kills.mjs kills.json [--out verificacao] [--killfeed x,y,w,h]
import path from 'node:path';
import fs from 'node:fs';
import * as L from './lib.mjs';
import { DEFAULT_STYLE } from './defaults.mjs';

const { pos, opt } = L.parseArgs(process.argv.slice(2));
if (!pos[0]) { console.error('uso: node verify-kills.mjs kills.json [--out pasta] [--killfeed x,y,w,h]'); process.exit(1); }
await L.checkTools();
const kp = path.resolve(pos[0]);
const doc = L.readJson(kp);
const out = path.resolve(opt.out || path.join(path.dirname(kp), 'verificacao'));
fs.mkdirSync(out, { recursive: true });
L.ensureFont(out, null);
const kf = { ...DEFAULT_STYLE.output.killfeed };
if (typeof opt.killfeed === 'string') { const [x, y, w, h] = opt.killfeed.split(',').map(Number); Object.assign(kf, { x, y, w, h }); }
const crop = `crop=iw*${kf.w}:ih*${kf.h}:iw*${kf.x}:ih*${kf.y}`;

const warnings = [];
let sheetIdx = 0;
const rowsFiles = [];
for (const [ci, c] of (doc.clips || []).entries()) {
  const file = path.resolve(path.dirname(kp), c.file);
  const dur = (await L.probe(file)).duration;
  const ks = (c.kills || []).map((k) => k.t).sort((a, b) => a - b);
  ks.forEach((t, i) => {
    if (dur - t < 1.5) warnings.push(`clipe ${ci + 1} (${path.basename(file)}): kill em ${t}s a ${(dur - t).toFixed(1)}s do fim — pode ser a sua morte`);
    if (i && t - ks[i - 1] < 0.3) warnings.push(`clipe ${ci + 1}: kills em ${ks[i - 1]}s e ${t}s quase juntos — duplicado?`);
  });
  for (const t of ks) {
    const f = path.join(out, `row_${String(sheetIdx++).padStart(3, '0')}.jpg`);
    const vf = `${crop},fps=4,scale=300:-2,drawtext=fontfile=font.ttf:text='c${ci + 1} %{pts\\:hms}':x=3:y=3:fontsize=13:fontcolor=yellow:box=1:boxcolor=black@0.7,tile=10x1:padding=2`;
    await L.ffmpeg(['-ss', String(Math.max(0, t - 1)), '-t', '2.5', '-copyts', '-i', file, '-an', '-vf', vf, '-frames:v', '1', '-y', f], { cwd: out, allowFail: true });
    if (fs.existsSync(f)) rowsFiles.push(f);
  }
}
// Junta de 8 em 8 linhas por imagem.
const sheets = [];
for (let i = 0; i < rowsFiles.length; i += 8) {
  const part = rowsFiles.slice(i, i + 8);
  const sheet = path.join(out, `verificar_${String(sheets.length + 1).padStart(2, '0')}.jpg`);
  const args = part.flatMap((f) => ['-i', f]);
  const fc = part.length > 1 ? `${part.map((_, k) => `[${k}:v]`).join('')}vstack=inputs=${part.length}` : 'null';
  await L.ffmpeg(['-y', ...args, '-filter_complex', fc, '-frames:v', '1', sheet], { allowFail: true });
  sheets.push(sheet);
}
for (const f of rowsFiles) fs.rmSync(f, { force: true });
console.log(`${rowsFiles.length} kills em ${sheets.length} imagem(ns): cada linha vai de 1 s antes a 1,5 s depois do kill (rótulo c<n> = clipe).`);
for (const s of sheets) console.log(`  ${s}`);
if (warnings.length) { console.log('\nSuspeitos (confira primeiro):'); for (const w of warnings) console.log(`  • ${w}`); }
