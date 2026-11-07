#!/usr/bin/env node
// Prepara uma VOD para análise: baixa uma cópia LEVE (proxy, ~480p) e o replay do chat com o tempo de cada
// mensagem. Os clipes finais são cortados depois direto da fonte em alta (make-clips), sem baixar a VOD inteira em 1080p.
//   node fetch-vod.mjs <id-ou-url-da-vod | arquivo-local.mp4> [--vod-id 123 (chat de um arquivo local)] [--chat chat.json] [--no-chat]
// Saída: <dataDir>/<id>/source.json, proxy.mp4 (só p/ Twitch), chat.json
import fs from 'node:fs';
import path from 'node:path';
import { L, loadConfig, parseArgs, ytdlp, twitchDownloaderPath, vodDir, hms } from './lib.mjs';

const { pos, opt } = parseArgs(process.argv.slice(2));
if (!pos[0]) { console.error('uso: node fetch-vod.mjs <id|url|arquivo> [--vod-id ID] [--chat chat.json] [--no-chat]'); process.exit(1); }
await L.checkTools();
const cfg = loadConfig();
const arg = pos[0];
const local = fs.existsSync(arg);
const vodId = local ? (opt['vod-id'] ? String(opt['vod-id']) : null) : (String(arg).match(/(\d{6,})/) || [])[1];
if (!local && !vodId) { console.error(`não entendi "${arg}": passe o número da VOD, o link twitch.tv/videos/... ou um arquivo de vídeo`); process.exit(1); }
const key = local ? `local-${path.basename(arg, path.extname(arg)).replace(/[^\w-]+/g, '_')}` : vodId;
const dir = vodDir(cfg, key);
const srcF = path.join(dir, 'source.json');
let src = fs.existsSync(srcF) ? L.readJson(srcF) : null;

if (!src) {
  if (local) {
    const info = await L.probe(path.resolve(arg));
    src = { kind: 'local', key, file: path.resolve(arg), vodId, title: path.basename(arg), duration: info.duration, width: info.width, height: info.height };
  } else {
    const r = await ytdlp(['-J', `https://www.twitch.tv/videos/${vodId}`]);
    const j = JSON.parse(r.stdout);
    if (j.is_live) { console.error('Essa VOD ainda está AO VIVO. Espere a live terminar (o modo autônomo faz isso sozinho).'); process.exit(3); }
    src = { kind: 'twitch', key, vodId, url: `https://www.twitch.tv/videos/${vodId}`, title: j.title, created: j.timestamp ? new Date(j.timestamp * 1000).toISOString() : null,
      duration: j.duration, channel: j.uploader_id || j.uploader, heights: [...new Set((j.formats || []).map((f) => f.height).filter(Boolean))].sort((a, b) => a - b) };
  }
  L.writeJson(srcF, src);
}
console.log(`VOD: ${src.title} (${hms(src.duration)}) → ${dir}`);

// Proxy de análise
if (src.kind === 'twitch') {
  const proxy = path.join(dir, 'proxy.mp4');
  if (!fs.existsSync(proxy)) {
    console.log(`Baixando cópia leve (${cfg.proxyHeight}p) para análise... (VOD de 4 h ≈ 2–3 GB)`);
    await ytdlp(['-S', `res:${cfg.proxyHeight}`, '-f', 'b', '-N', '8', '--no-part', '-o', path.join(dir, 'proxy.%(ext)s'), src.url]);
    if (!fs.existsSync(proxy)) { const f = fs.readdirSync(dir).find((x) => x.startsWith('proxy.')); if (f) fs.renameSync(path.join(dir, f), proxy); }
  }
  src.proxy = proxy;
} else src.proxy = src.file;

// Chat
const chatOut = path.join(dir, 'chat.json');
if (opt.chat) fs.copyFileSync(path.resolve(opt.chat), chatOut);
else if (!opt['no-chat'] && vodId && !fs.existsSync(chatOut)) {
  const tdl = twitchDownloaderPath();
  if (!tdl) console.log('AVISO: TwitchDownloaderCLI não encontrado — sem chat (a nota usa só os outros sinais). Veja references/setup-twitch.md.');
  else {
    console.log('Baixando o replay do chat...');
    const r = await L.run(tdl, ['chatdownload', '--id', vodId, '-o', chatOut, '--collision', 'Overwrite']);
    if (r.code !== 0) console.log(`AVISO: falha ao baixar o chat: ${r.stderr.slice(-300)}`);
  }
}
if (fs.existsSync(chatOut)) {
  const n = L.readJson(chatOut).comments?.length || 0;
  src.chat = chatOut; src.chatMessages = n;
  console.log(`Chat: ${n} mensagens${n === 0 ? ' (vazio: destaque/rerun ou chat desativado)' : ''}`);
}
L.writeJson(srcF, src);
console.log('ok');
