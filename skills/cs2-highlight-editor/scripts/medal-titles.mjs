#!/usr/bin/env node
// Lê (somente leitura, numa cópia) o banco do Medal e lista os clipes com o título automático
// ("👊3K - Mirage", "☝️One Tap - Nuke", "🔪Knife - Dust II"...). Útil para escolher material:
//   node medal-titles.mjs --match 3K --game "Counter-Strike 2" --out medal_3k.json
// Requer Node >= 22 (node:sqlite).
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import * as L from './lib.mjs';

const { opt } = L.parseArgs(process.argv.slice(2));
const medalDir = opt.medal || path.join(os.homedir(), 'Videos', 'Medal');
const dbDir = path.join(medalDir, 'Databases');
const dbFile = fs.existsSync(dbDir) && fs.readdirSync(dbDir).find((f) => /^medal-.*\.db$/.test(f));
if (!dbFile) { console.error(`Banco do Medal não encontrado em ${dbDir} (use --medal <pasta do Medal>).`); process.exit(1); }

// Copia para não disputar o arquivo com o Medal aberto.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'medaldb-'));
for (const f of fs.readdirSync(dbDir).filter((f) => f.startsWith(dbFile))) fs.copyFileSync(path.join(dbDir, f), path.join(tmp, f));
const db = new DatabaseSync(path.join(tmp, dbFile), { readOnly: true });
const game = opt.game || 'Counter-Strike 2';
const rows = db.prepare('select video_path, metadata, created_at from contents where video_path like ?').all(`%${game}%`);
db.close();
fs.rmSync(tmp, { recursive: true, force: true });

const clips = rows.map((r) => {
  const s = Buffer.from(r.metadata).toString('utf8');
  const i = s.indexOf('title'), j = s.indexOf('clipDuration', i);
  const title = (i >= 0 && j > i ? s.slice(i + 5, j) : '').replace(/[\x00-\x1f\x7f�]/g, '').trim();
  const d = s.match(/clipDuration.([\d.]+)/);
  return { file: r.video_path, title, map: title.includes(' - ') ? title.split(' - ').slice(1).join(' - ').trim() : '', duration: d ? +d[1] : 0, created: r.created_at, exists: !!r.video_path && fs.existsSync(r.video_path) };
}).filter((c) => c.exists);

const match = opt.match ? new RegExp(opt.match, 'i') : null;
const sel = match ? clips.filter((c) => match.test(c.title)) : clips;
const count = {};
for (const c of clips) { const k = (c.title.match(/\d+K|One Tap|Headshot|Knife|Ace/i) || ['outros'])[0]; count[k] = (count[k] || 0) + 1; }
console.log(`${clips.length} clipes de ${game} no disco: ${JSON.stringify(count)}`);
console.log(`${sel.length} selecionados${match ? ` (/${opt.match}/)` : ''}.`);
if (opt.out) { L.writeJson(path.resolve(opt.out), sel.sort((a, b) => b.created - a.created)); console.log(`Lista: ${path.resolve(opt.out)}`); }
