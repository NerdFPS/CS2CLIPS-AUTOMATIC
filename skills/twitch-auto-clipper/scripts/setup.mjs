#!/usr/bin/env node
// Configuração e diagnóstico.
//   node setup.mjs --channel mrnerdfps            (grava o canal no config.json)
//   node setup.mjs --facecam x,y,w,h              (posição da facecam no stream, em frações 0–1; "none" para tirar)
//   node setup.mjs --killfeed x,y,w,h | --mic-track 1 | --top 6 | --edit zuhn | --lang pt
//   node setup.mjs --frame <id-ou-arquivo> [--at 600]   (tira um quadro com grade para achar a facecam)
//   node setup.mjs --vertical zoom|inteiro       (vertical sem facecam: zoom = corte central grande, padrão; inteiro = jogo todo numa faixa)
//   node setup.mjs                                (mostra o estado: ferramentas, credenciais, config)
import fs from 'node:fs';
import path from 'node:path';
import { L, CS2_DIR, CONFIG_FILE, ENV_FILE, loadConfig, saveConfig, parseArgs, hasCredentials, helix, twitchDownloaderPath } from './lib.mjs';

const { opt } = parseArgs(process.argv.slice(2));
const rect = (s) => { if (s === 'none') return null; const [x, y, w, h] = String(s).split(',').map(Number); if ([x, y, w, h].some((v) => !(v >= 0 && v <= 1))) throw new Error('use frações 0–1: x,y,w,h'); return { x, y, w, h }; };
const patch = {};
if (opt.channel) patch.channel = String(opt.channel).toLowerCase().replace(/^.*twitch\.tv\//, '').replace(/\/.*$/, '');
if (opt.facecam) patch.facecam = rect(opt.facecam);
if (opt.vertical) { if (!['zoom', 'inteiro'].includes(String(opt.vertical))) { console.log('--vertical aceita zoom ou inteiro'); process.exit(1); } patch.verticalSemCam = String(opt.vertical); }
if (opt.killfeed) patch.killfeed = rect(opt.killfeed);
if (opt['mic-track'] !== undefined) patch.micTrack = opt['mic-track'] === 'none' ? null : Number(opt['mic-track']);
if (opt.top) patch.topN = Number(opt.top);
if (opt.edit) patch.edit = opt.edit === 'none' ? null : opt.edit;
if (opt.lang) patch.lang = opt.lang;
if (opt['data-dir']) patch.dataDir = path.resolve(opt['data-dir']);
if (Object.keys(patch).length) { saveConfig(patch); console.log('config.json atualizado:', patch); }

if (opt.frame) {
  const cfg = loadConfig();
  const p = fs.existsSync(opt.frame) ? path.resolve(opt.frame) : path.join(cfg.dataDir, String(opt.frame), 'proxy.mp4');
  const out = path.join(path.dirname(p), 'quadro_grade.jpg');
  const grid = Array.from({ length: 9 }, (_, i) => `drawbox=x=iw*${(i + 1) / 10}:y=0:w=1:h=ih:color=yellow@0.6,drawbox=x=0:y=ih*${(i + 1) / 10}:w=iw:h=1:color=yellow@0.6`).join(',');
  await L.ffmpeg(['-ss', String(opt.at || 600), '-i', p, '-frames:v', '1', '-vf', `scale=1280:-2,${grid}`, '-y', out]);
  console.log(`Quadro com grade de 10% em: ${out}\nOlhe a imagem e grave a facecam: node setup.mjs --facecam x,y,w,h (ex.: 0.72,0.62,0.27,0.36)`);
}

const cfg = loadConfig();
const ok = (b) => (b ? '✅' : '❌');
const tdl = twitchDownloaderPath();
const ff = (await L.run(L.FFMPEG, ['-version'])).code === 0;
const yd = (await L.run(L.ytdlpPath(), ['--version'])).code === 0;
const uv = (await L.run('uv', ['--version'])).code === 0;
const gpu = (await L.run('nvidia-smi', ['-L'])).code === 0;
let cred = hasCredentials() ? 'presentes' : 'ausentes (o yt-dlp lista as VODs sem login; veja references/setup-twitch.md)';
if (hasCredentials()) { try { await helix('users', { login: cfg.channel || 'twitch' }); cred = 'OK (token de app)'; } catch (e) { cred = `ERRO: ${e.message}`; } }
console.log(`
twitch-auto-clipper — estado
  ${ok(ff)} FFmpeg          ${ok(yd)} yt-dlp          ${ok(uv)} uv (Whisper local)     ${gpu ? '✅ GPU NVIDIA' : '⚪ sem GPU NVIDIA (Whisper na CPU, mais lento)'}
  ${ok(tdl)} TwitchDownloaderCLI (chat) ${tdl || '— sem ele a nota não usa o chat'}
  ✅ cs2-highlight-editor: ${CS2_DIR}
  Credenciais (${ENV_FILE}): ${cred}
  Config (${CONFIG_FILE}):
    canal: ${cfg.channel || '— defina com --channel'} · idioma: ${cfg.lang} · clipes por VOD: ${cfg.topN} · edit: ${cfg.edit || 'não'}
    facecam: ${cfg.facecam ? JSON.stringify(cfg.facecam) : `não definida (vertical sem cam: ${cfg.verticalSemCam || 'zoom'})`} · trilha do mic: ${cfg.micTrack ?? 'não (VOD da Twitch tem uma trilha só)'}
    pesos: ${Object.entries(cfg.weights).map(([k, v]) => `${k} ${v}`).join(', ')}
    dados: ${cfg.dataDir}`);
