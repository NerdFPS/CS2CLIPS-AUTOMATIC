#!/usr/bin/env node
// Relatório da VOD (report.md): tabela com tempo, nota, motivo e link do momento na VOD de cada clipe,
// mais os candidatos que ficaram de fora. Registra os clipes em <dataDir>/calibracao.jsonl para calibrar
// os pesos depois com as views reais (calibrate.mjs).
//   node report.mjs <pasta-da-vod|id>
import fs from 'node:fs';
import path from 'node:path';
import { L, loadConfig, parseArgs, hms, vodLink } from './lib.mjs';

const { pos } = parseArgs(process.argv.slice(2));
if (!pos[0]) { console.error('uso: node report.mjs <pasta-da-vod|id>'); process.exit(1); }
const cfg = loadConfig();
const dir = fs.existsSync(pos[0]) ? path.resolve(pos[0]) : path.join(cfg.dataDir, String(pos[0]));
const src = L.readJson(path.join(dir, 'source.json'));
const C = L.readJson(path.join(dir, 'candidates.json'));
const K = fs.existsSync(path.join(dir, 'clips.json')) ? L.readJson(path.join(dir, 'clips.json')) : { clips: [] };
const made = new Map(K.clips.map((c) => [c.rank, c]));
const link = (t) => { const u = vodLink(src.vodId, t); return u ? `[${hms(t)}](${u})` : hms(t); };
const rel = (f) => path.relative(dir, f).replace(/\\/g, '/');
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

const lines = [];
lines.push(`# Clipes da VOD: ${src.title}`, '');
lines.push(`- **VOD:** ${src.url ? `[${src.vodId}](${src.url})` : src.file} · duração ${hms(src.duration)}${src.created ? ` · ${src.created.slice(0, 10)}` : ''}`);
lines.push(`- **Sinais usados:** ${C.signalsUsed.join(', ')}${C.chatLag != null ? ` · atraso do chat estimado: ${C.chatLag} s` : ''} · ${C.kills} kills do POV detectados · ${C.chatMessages} mensagens de chat`);
lines.push(`- **Pesos:** ${Object.entries(C.weights).map(([k, v]) => `${k} ${Math.round(v * 100)}`).join(' · ')}`);
lines.push('', '> **A nota (0–100) é uma ordenação por sinais, não a chance real de viralizar.** Ela diz quais momentos têm mais sinais fortes juntos (kills, grito, chat, fala) segundo o estudo em `references/viral-notes.md`. Depois de postar, anote as views com `calibrate.mjs` para os pesos aprenderem com o seu público.', '');
if (K.clips.length) {
  lines.push('## Clipes gerados', '', '| # | Momento na VOD | Nota | Por quê | Duração | Título sugerido | Arquivos |', '|---|---|---|---|---|---|---|');
  for (const c of K.clips) {
    const f = c.files.filter((x) => /_(9x16|16x9)\.mp4$/.test(x)).map((x) => `[${/9x16/.test(x) ? '9:16' : '16:9'}](${rel(x)})`).join(' · ');
    lines.push(`| ${c.rank} | ${link(c.start)}–${hms(c.end)} (ápice ${link(c.apex)}) | **${c.score}** | ${cell(c.reasons.join(' · '))} | ${Math.round(c.duration)} s | ${cell(c.title)} | ${f}${c.edit ? ` · [edit](${rel(c.edit)})` : ''} |`);
  }
  const unrev = K.clips.filter((c) => c.captions && !c.captionsReviewed).map((c) => c.rank);
  if (unrev.length) lines.push('', `⚠️ Legendas automáticas **não revisadas** nos clipes ${unrev.join(', ')}: o Whisper pode errar palavras (confira antes de postar).`);
  lines.push('', `Cada pasta tem também a capa (\`_capa*.jpg\`) e a cópia leve para celular (\`_celular.mp4\`). Layout vertical: ${K.clips[0]?.layout === 'facecam-em-cima' ? 'facecam em cima, jogo embaixo' : 'jogo inteiro sobre fundo desfocado (configure a facecam para o layout empilhado)'}.`);
}
const rest = C.candidates.filter((c) => !made.has(c.rank));
if (rest.length) {
  lines.push('', '## Outros candidatos (não renderizados)', '', '| # | Momento | Nota | Por quê | Trecho da fala |', '|---|---|---|---|---|');
  for (const c of rest) lines.push(`| ${c.rank} | ${link(c.start)}–${hms(c.end)} | ${c.score} | ${cell(c.reasons.join(' · '))} | ${cell(c.quote.slice(0, 80))} |`);
  lines.push('', 'Para gerar algum deles: `node make-clips.mjs <vod> --ranks 7,9`.');
}
lines.push('', '---', 'Nada foi postado nem nenhum clipe oficial foi criado na Twitch. Música (se houver) só do NCS, com o crédito no `.credito.txt`.');
fs.writeFileSync(path.join(dir, 'report.md'), lines.join('\n'));

// Registro para calibração
const ledgerF = path.join(cfg.dataDir, 'calibracao.jsonl');
// Regerar a mesma VOD substitui as entradas dela que ainda não têm views (os ranks mudam a cada análise);
// entradas com views anotadas nunca são apagadas.
const old = fs.existsSync(ledgerF) ? fs.readFileSync(ledgerF, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const keep = old.filter((j) => j.vod !== src.key || j.views != null);
const have = new Set(keep.map((j) => `${j.vod}:${j.start}`));
const add = K.clips.filter((c) => !have.has(`${src.key}:${c.start}`)).map((c) => ({ vod: src.key, rank: c.rank, start: c.start, score: c.score, components: c.components, title: c.title, created: K.created, posted: null, platform: null, views: null }));
fs.writeFileSync(ledgerF, [...keep, ...add].map((j) => JSON.stringify(j)).join('\n') + '\n');
console.log(`Relatório: ${path.join(dir, 'report.md')}${add.length ? ` · ${add.length} clipes registrados em ${ledgerF}` : ''}`);
