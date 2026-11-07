// Funções comuns do twitch-auto-clipper: configuração, credenciais (.env fora do repo), API Helix,
// caminhos de trabalho e acesso à biblioteca da cs2-highlight-editor (ffmpeg, killfeed, fontes, encoder).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- cs2-highlight-editor (reutilizada, nunca copiada) ----
function findCs2Dir() {
  const cands = [process.env.CS2HL_DIR, path.join(SKILL_DIR, '..', 'cs2-highlight-editor'), path.join(os.homedir(), '.claude', 'skills', 'cs2-highlight-editor')];
  for (const c of cands) if (c && fs.existsSync(path.join(c, 'scripts', 'lib.mjs'))) return path.resolve(c);
  console.error('ERRO: a skill cs2-highlight-editor não foi encontrada (defina CS2HL_DIR). Ela é obrigatória: https://github.com/NerdFPS/CS2CLIPS-AUTOMATIC');
  process.exit(2);
}
export const CS2_DIR = findCs2Dir();
export const CS2_SCRIPTS = path.join(CS2_DIR, 'scripts');
export const L = await import(pathToFileURL(path.join(CS2_SCRIPTS, 'lib.mjs')).href);
export const { DEFAULT_STYLE } = await import(pathToFileURL(path.join(CS2_SCRIPTS, 'defaults.mjs')).href);

// ---- Configuração ----
// Segredos: ~/.config/twitch-auto-clipper/.env (TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET). Nunca no repositório.
// Preferências: ~/.config/twitch-auto-clipper/config.json. Dados (VODs, clipes, relatórios): config.dataDir.
export const CONFIG_DIR = process.env.TAC_CONFIG_DIR || path.join(os.homedir(), '.config', 'twitch-auto-clipper');
export const ENV_FILE = process.env.TAC_ENV_FILE || path.join(CONFIG_DIR, '.env');
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export const DEFAULT_CONFIG = {
  channel: '',
  lang: 'pt',
  dataDir: path.join(os.homedir(), 'Videos', 'TwitchAutoClipper'),
  topN: 6,
  proxyHeight: 480,            // resolução baixada para ANALISAR (os clipes vêm da fonte em até 1080p)
  clipHeight: 1080,
  whisperModel: 'large-v3-turbo',
  micTrack: null,              // índice da trilha só do microfone (gravação local do OBS com várias trilhas)
  facecam: null,               // {x,y,w,h} em frações do quadro 16:9; null = sem facecam
  verticalSemCam: 'zoom',      // sem facecam: 'zoom' (corte central 4:5 grande) ou 'inteiro' (jogo todo numa faixa)
  killfeed: null,              // {x,y,w,h}; null = padrão da cs2-highlight-editor
  chatLag: null,               // segundos que o chat atrasa; null = estimar por VOD
  clip: { pre: 12, post: 7, min: 15, max: 60 },
  weights: { kills: 0.30, voice: 0.25, chat: 0.25, keywords: 0.15, scene: 0.05 },
  edit: null,                  // ex.: "zuhn" para gerar também a versão edit das jogadas
  autoTitles: true,
};

export function readEnv() {
  const env = {};
  if (fs.existsSync(ENV_FILE)) {
    for (const line of fs.readFileSync(ENV_FILE, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return { TWITCH_CLIENT_ID: process.env.TWITCH_CLIENT_ID || env.TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET: process.env.TWITCH_CLIENT_SECRET || env.TWITCH_CLIENT_SECRET };
}

function deepMerge(a, b) {
  const o = { ...a };
  for (const [k, v] of Object.entries(b || {})) o[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? deepMerge(a[k], v) : v;
  return o;
}
export function loadConfig() {
  const user = fs.existsSync(CONFIG_FILE) ? L.readJson(CONFIG_FILE) : {};
  return deepMerge(DEFAULT_CONFIG, user);
}
export function saveConfig(patch) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const cur = fs.existsSync(CONFIG_FILE) ? L.readJson(CONFIG_FILE) : {};
  L.writeJson(CONFIG_FILE, deepMerge(cur, patch));
}

// ---- Helix (token de APP: basta para ler vídeos e lives públicos; nenhum escopo) ----
const TOKEN_FILE = path.join(CONFIG_DIR, 'app-token.json');
export function hasCredentials() { const e = readEnv(); return !!(e.TWITCH_CLIENT_ID && e.TWITCH_CLIENT_SECRET); }
async function appToken() {
  const e = readEnv();
  if (!e.TWITCH_CLIENT_ID || !e.TWITCH_CLIENT_SECRET) throw new Error(`credenciais ausentes em ${ENV_FILE} (veja references/setup-twitch.md)`);
  if (fs.existsSync(TOKEN_FILE)) {
    const t = L.readJson(TOKEN_FILE);
    if (t.client_id === e.TWITCH_CLIENT_ID && t.expires_at > Date.now() + 3600e3) return t.access_token;
  }
  const r = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', body: new URLSearchParams({ client_id: e.TWITCH_CLIENT_ID, client_secret: e.TWITCH_CLIENT_SECRET, grant_type: 'client_credentials' }) });
  if (!r.ok) throw new Error(`a Twitch recusou as credenciais (HTTP ${r.status}). Confira Client ID e Secret no .env.`);
  const j = await r.json();
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  L.writeJson(TOKEN_FILE, { client_id: e.TWITCH_CLIENT_ID, access_token: j.access_token, expires_at: Date.now() + j.expires_in * 1000 });
  return j.access_token;
}
export async function helix(endpoint, params = {}) {
  const e = readEnv();
  const url = new URL(`https://api.twitch.tv/helix/${endpoint}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, v);
  let tok = await appToken();
  let r = await fetch(url, { headers: { 'Client-Id': e.TWITCH_CLIENT_ID, Authorization: `Bearer ${tok}` } });
  if (r.status === 401) { fs.rmSync(TOKEN_FILE, { force: true }); tok = await appToken(); r = await fetch(url, { headers: { 'Client-Id': e.TWITCH_CLIENT_ID, Authorization: `Bearer ${tok}` } }); }
  if (!r.ok) throw new Error(`Helix ${endpoint}: HTTP ${r.status} ${await r.text()}`);
  return r.json();
}

// ---- Ferramentas externas ----
export function twitchDownloaderPath() {
  const cands = [process.env.TWITCH_DOWNLOADER_CLI, path.join(os.homedir(), '.local', 'share', 'twitch-auto-clipper', 'bin', process.platform === 'win32' ? 'TwitchDownloaderCLI.exe' : 'TwitchDownloaderCLI')];
  for (const c of cands) if (c && fs.existsSync(c)) return c;
  return null;
}
export async function ytdlp(args, opts = {}) {
  const r = await L.run(L.ytdlpPath(), args, opts);
  if (r.code !== 0 && !opts.allowFail) throw new Error(`yt-dlp falhou: ${r.stderr.split(/\r?\n/).filter(Boolean).slice(-5).join(' | ')}`);
  return r;
}

// ---- Utilidades ----
export const parseArgs = L.parseArgs;
export function hms(s) {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(x).padStart(2, '0')}`;
}
export function vodLink(vodId, s) {
  if (!vodId || !/^\d+$/.test(String(vodId))) return null;
  s = Math.max(0, Math.floor(s));
  return `https://www.twitch.tv/videos/${vodId}?t=${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m${s % 60}s`;
}
export function vodDir(cfg, vodKey) { const d = path.join(cfg.dataDir, String(vodKey)); fs.mkdirSync(d, { recursive: true }); return d; }
export function slug(s, n = 40) {
  return (s || 'clipe').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, n) || 'clipe';
}
export const clamp01 = (x) => Math.max(0, Math.min(1, x));
export function robustZ(arr) {
  const med = L.median(arr);
  const mad = L.median(arr.map((v) => Math.abs(v - med))) * 1.4826 || 1e-6;
  return arr.map((v) => (v - med) / mad);
}
// Mediana móvel aproximada (blocos) — rápida para séries de horas.
export function rollingMedian(arr, win) {
  const out = new Array(arr.length), step = Math.max(1, Math.floor(win / 6));
  const anchors = [];
  for (let i = 0; i < arr.length; i += step) anchors.push([i, L.median(arr.slice(Math.max(0, i - win / 2), Math.min(arr.length, i + win / 2)))]);
  let a = 0;
  for (let i = 0; i < arr.length; i++) {
    while (a + 1 < anchors.length && anchors[a + 1][0] <= i) a++;
    const [i0, v0] = anchors[a], nx = anchors[a + 1];
    out[i] = nx ? v0 + ((nx[1] - v0) * (i - i0)) / (nx[0] - i0) : v0;
  }
  return out;
}

// ---- VODs do canal (Helix com credenciais; yt-dlp sem login) ----
function parseDur(s) { const m = String(s).match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/); return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0); }
export async function listVods({ channel, n = 10, all = false } = {}) {
  if (!channel) throw new Error('canal não definido: use --channel ou rode setup.mjs --channel <login>');
  if (hasCredentials()) {
    const u = await helix('users', { login: channel });
    if (!u.data.length) throw new Error(`canal "${channel}" não existe na Twitch`);
    const [v, live] = await Promise.all([helix('videos', { user_id: u.data[0].id, type: all ? 'all' : 'archive', first: Math.min(100, n) }), helix('streams', { user_id: u.data[0].id })]);
    const liveStreamId = live.data[0]?.id || null;
    return v.data.map((x) => ({ id: x.id, title: x.title, created: x.created_at, type: x.type, url: x.url, views: x.view_count,
      duration: parseDur(x.duration), live: !!(liveStreamId && x.stream_id === liveStreamId), source: 'helix' }));
  }
  const r = await ytdlp(['--flat-playlist', '-J', '--playlist-end', String(n), `https://www.twitch.tv/${channel}/videos?filter=${all ? 'all' : 'archives'}&sort=time`]);
  return (JSON.parse(r.stdout).entries || []).map((e) => ({ id: String(e.id).replace(/^v/, ''), title: e.title,
    created: e.timestamp ? new Date(e.timestamp * 1000).toISOString() : null, type: all ? null : 'archive', url: e.url, views: e.view_count,
    duration: e.duration, live: !!e.is_live, source: 'yt-dlp' }));
}
export const NO_VODS_HINT = 'Nenhuma VOD encontrada. Ligue "Armazenar transmissões anteriores" em twitch.tv/dashboard/settings/stream (a Twitch apaga depois de 7 dias; afiliados 14, parceiros 60) ou passe um arquivo gravado localmente.';

// ---------- Killfeed de live inteira: kill × morte ----------
// O detector da cs2-highlight-editor (feito para clipes do Medal) conta toda caixa com moldura vermelha.
// Numa live inteira isso inclui a linha da SUA MORTE, que no CS2 também tem moldura vermelha, mas com
// fundo vermelho saturado; a do seu kill/assistência tem fundo escuro neutro. Aqui cada borda fina
// vermelha é classificada pela cor logo acima e logo abaixo dela (o lado escuro é o "dentro" da caixa).
// Quadro já recortado no killfeed (366×130, como os blocos _kf do analyze-vod).
export async function ownKillfeedEvents(file, fps = 10) {
  const W = 366, H = 130;
  const r = await L.run(L.FFMPEG, ['-hide_banner', '-nostdin', '-v', 'error', '-i', file, '-an', '-vf', `fps=${fps},scale=${W}:${H}`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { binary: true });
  if (r.code !== 0) return { kills: [], deaths: [] };
  const buf = r.stdout, fsz = W * H * 3, n = Math.floor(buf.length / fsz);
  const md = (a) => { if (!a.length) return 0; a.sort((p, q) => p - q); return a[a.length >> 1]; };
  const killN = new Array(n).fill(0), deathN = new Array(n).fill(0);
  for (let f = 0; f < n; f++) {
    const o = f * fsz;
    const red = (p) => buf[p] > 95 && buf[p + 1] < 0.45 * buf[p] && buf[p + 2] < 0.45 * buf[p] && buf[p] - buf[p + 1] > 55;
    const side = (y0, y1, x0, x1) => {
      const R = [], G = [], B = [];
      for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) for (let x = x0 + 4; x <= x1 - 4; x += 2) { const p = o + (y * W + x) * 3; R.push(buf[p]); G.push(buf[p + 1]); B.push(buf[p + 2]); }
      return [md(R), md(G), md(B)];
    };
    const satRed = ([rr, g]) => rr > 60 && g < 0.35 * rr;           // fundo da linha da sua morte
    const dark = ([rr, g, b]) => Math.max(rr, g, b) < 100 && !satRed([rr, g]); // fundo da caixa de kill
    const kb = [], db = [];
    let run = 0, x0 = 0, x1 = 0;
    for (let y = 0; y <= H; y++) {
      let on = false, a = -1, z = -1;
      if (y < H) { let k = 0; for (let x = 0; x < W; x++) if (red(o + (y * W + x) * 3)) { k++; if (a < 0) a = x; z = x; } on = k >= 50 && k <= W * 0.95 && z >= W - 14 && k >= 0.7 * (z - a + 1); } // caixas do killfeed encostam na direita e são contínuas (menu/inventário não)
      if (on) { if (!run) { x0 = a; x1 = z; } run++; continue; }
      if (run >= 1 && run <= 3 && x1 - x0 > 60) {
        const top = y - run, up = side(top - 5, top - 2, x0, x1), dn = side(y + 1, y + 4, x0, x1);
        if (satRed(up) || satRed(dn)) db.push(top);
        else if (dark(dn)) kb.push(top);          // borda de cima: dentro é embaixo
        else if (dark(up)) kb.push(top - 14);     // borda de baixo: a caixa começa ~14 px acima
      }
      run = 0;
    }
    const uniq = (arr) => arr.sort((p, q) => p - q).filter((v, i, s) => !i || v - s[i - 1] > 5).length;
    killN[f] = uniq(kb); deathN[f] = uniq(db);
  }
  // Suaviza (mediana ~0,9 s, nível mantido ~0,8 s) e marca evento quando o nível passa do máximo dos últimos 3 s
  // (uma caixa que some e volta por causa de flash/tela escura não vira kill de novo).
  const events = (cnt) => {
    const half = Math.round(fps * 0.45), hold = Math.round(fps * 0.8), back = fps * 3;
    const med = cnt.map((_, i) => L.median(cnt.slice(Math.max(0, i - half), Math.min(n, i + half + 1))));
    const sm = med.map((_, i) => Math.min(...med.slice(i, Math.min(n, i + hold))));
    const out = [];
    for (let i = 1; i < n; i++) {
      const prev = Math.max(0, ...sm.slice(Math.max(0, i - back), i));
      if (sm[i] <= prev) continue;
      let j = i; for (let k = i - 1; k >= Math.max(0, i - Math.round(fps * 0.6)); k--) if (cnt[k] >= sm[i]) j = k;
      for (let k = 0; k < sm[i] - prev; k++) out.push(+(j / fps + k * 0.15).toFixed(2));
    }
    return out;
  };
  // Kill colado (±0,5 s) numa morte detectada costuma ser a própria linha da morte lida errado.
  const deaths = events(deathN);
  return { kills: events(killN).filter((t) => !deaths.some((d) => Math.abs(d - t) <= 0.5)), deaths };
}
