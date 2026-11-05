// Funções compartilhadas: ffmpeg/ffprobe, análise de áudio (beats) e de vídeo.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// No Windows, o winget instala o FFmpeg mas o PATH só vale para terminais novos: procura a pasta direto.
function wingetFfmpegBin() {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) return null;
  const pk = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages');
  try {
    for (const d of fs.readdirSync(pk).filter((x) => x.startsWith('Gyan.FFmpeg'))) {
      for (const sub of fs.readdirSync(path.join(pk, d))) {
        const bin = path.join(pk, d, sub, 'bin');
        if (fs.existsSync(path.join(bin, 'ffmpeg.exe'))) return bin;
      }
    }
  } catch { /* sem winget */ }
  return null;
}
const WINGET_BIN = !process.env.FFMPEG_PATH ? wingetFfmpegBin() : null;
export const FFMPEG = process.env.FFMPEG_PATH || (WINGET_BIN ? path.join(WINGET_BIN, 'ffmpeg.exe') : 'ffmpeg');
export const FFPROBE = process.env.FFPROBE_PATH || (WINGET_BIN ? path.join(WINGET_BIN, 'ffprobe.exe') : 'ffprobe');
export const VIDEO_EXT = ['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v'];

// yt-dlp (baixar referências e músicas). winget instala fora do PATH em terminais antigos.
export function ytdlpPath() {
  if (process.env.YTDLP_PATH) return process.env.YTDLP_PATH;
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const pk = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages');
    try {
      for (const d of fs.readdirSync(pk).filter((x) => x.startsWith('yt-dlp.yt-dlp'))) {
        const p = path.join(pk, d, 'yt-dlp.exe');
        if (fs.existsSync(p)) return p;
      }
    } catch { /* sem winget */ }
  }
  return 'yt-dlp';
}
export async function checkYtdlp() {
  const r = await run(ytdlpPath(), ['--version']);
  if (r.code !== 0) {
    console.error('ERRO: yt-dlp não encontrado. Peça permissão ao usuário e instale:\n  Windows: winget install yt-dlp.yt-dlp\n  macOS: brew install yt-dlp   Linux: pipx install yt-dlp\nOu defina YTDLP_PATH.');
    process.exit(2);
  }
}
// Pasta do ffmpeg para o yt-dlp juntar vídeo+áudio.
export const FFMPEG_DIR = path.isAbsolute(FFMPEG) ? path.dirname(FFMPEG) : null;

export const f3 = (x) => Number(x).toFixed(3);

export function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (!done) { done = true; resolve(r); } };
    let child;
    try { child = spawn(cmd, args, { cwd: opts.cwd, windowsHide: true }); }
    catch (e) { finish({ code: -1, stdout: '', stderr: String(e) }); return; }
    const out = [];
    let err = '';
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => {
      err += d.toString();
      if (!opts.keepStderr && err.length > 4e6) err = err.slice(-1e6);
    });
    child.on('error', (e) => finish({ code: -1, stdout: '', stderr: String(e) }));
    child.on('close', (code) => {
      const buf = Buffer.concat(out);
      finish({ code, stdout: opts.binary ? buf : buf.toString(), stderr: err });
    });
  });
}

export async function ffmpeg(args, opts = {}) {
  const r = await run(FFMPEG, ['-hide_banner', '-nostdin', ...args], opts);
  if (r.code !== 0 && !opts.allowFail) {
    const tail = r.stderr.split(/\r?\n/).slice(-40).join('\n');
    throw new Error(`ffmpeg falhou (código ${r.code}).\nComando: ffmpeg ${args.join(' ')}\n--- saída ---\n${tail}`);
  }
  return r;
}

export async function checkTools() {
  for (const t of [FFMPEG, FFPROBE]) {
    const r = await run(t, ['-version']);
    if (r.code !== 0) {
      console.error(`ERRO: "${t}" não encontrado. Instale o FFmpeg e deixe-o no PATH.\n` +
        `  Windows: winget install Gyan.FFmpeg   (depois abra um terminal novo)\n` +
        `  macOS:   brew install ffmpeg\n  Linux:   sudo apt install ffmpeg\n` +
        `Ou defina FFMPEG_PATH e FFPROBE_PATH com o caminho dos executáveis.`);
      process.exit(2);
    }
  }
}

export async function probe(file) {
  const r = await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  if (r.code !== 0) throw new Error(`ffprobe falhou em ${file}: ${r.stderr}`);
  const j = JSON.parse(r.stdout);
  const v = j.streams.find((s) => s.codec_type === 'video');
  const a = j.streams.find((s) => s.codec_type === 'audio');
  const rate = v && v.avg_frame_rate && v.avg_frame_rate !== '0/0' ? v.avg_frame_rate : v?.r_frame_rate;
  const [n, d] = (rate || '0/1').split('/').map(Number);
  return {
    duration: Number(j.format?.duration) || Number(v?.duration) || Number(a?.duration) || 0,
    width: v?.width || 0,
    height: v?.height || 0,
    fps: d ? n / d : 0,
    hasVideo: !!v,
    hasAudio: !!a,
  };
}

export async function decodePcm(file, sr = 22050) {
  const r = await run(FFMPEG, ['-hide_banner', '-nostdin', '-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(sr), '-f', 'f32le', '-'], { binary: true });
  if (r.code !== 0 || !r.stdout.length) return new Float32Array(0);
  const ab = new ArrayBuffer(r.stdout.length - (r.stdout.length % 4));
  new Uint8Array(ab).set(r.stdout.subarray(0, ab.byteLength));
  return new Float32Array(ab);
}

// Lê as linhas de metadata=print do stderr: [{t, 'lavfi.x': valor}]
export function parseMetadata(stderr) {
  const frames = [];
  let cur = null;
  for (const line of stderr.split(/\r?\n/)) {
    const m = line.match(/pts_time:\s*([-\d.]+)/);
    if (m && line.includes('frame:')) { cur = { t: Number(m[1]) }; frames.push(cur); continue; }
    const k = line.match(/(lavfi\.[\w.]+)=([-\d.eE+]+|nan|inf)/);
    if (k && cur) cur[k[1]] = Number(k[2]);
  }
  return frames;
}

// Mudanças de cena (cortes). prefix permite recortar uma região antes (ex.: killfeed).
export async function sceneScores(file, threshold, prefix = '') {
  const vf = `${prefix}select='gt(scene,${threshold})',metadata=print`;
  const r = await ffmpeg(['-i', file, '-an', '-vf', vf, '-f', 'null', '-'], { keepStderr: true });
  return parseMetadata(r.stderr).map((fr) => ({ t: fr.t, score: fr['lavfi.scene_score'] ?? 0 }));
}

export async function signalStats(file, fps = 30, width = 160) {
  const vf = `fps=${fps},scale=${width}:-2,signalstats,metadata=print`;
  const r = await ffmpeg(['-i', file, '-an', '-vf', vf, '-f', 'null', '-'], { keepStderr: true });
  return parseMetadata(r.stderr).map((fr) => ({
    t: fr.t,
    y: fr['lavfi.signalstats.YAVG'],
    sat: fr['lavfi.signalstats.SATAVG'],
    lo: fr['lavfi.signalstats.YLOW'],
    hi: fr['lavfi.signalstats.YHIGH'],
  }));
}

export async function extractFrame(file, t, out, width = 640, vfPrefix = '') {
  await ffmpeg(['-ss', f3(Math.max(0, t)), '-i', file, '-frames:v', '1', '-vf', `${vfPrefix}scale=${width}:-2`, '-q:v', '3', '-y', out]);
}

const FONT_CANDIDATES = [
  'C:/Windows/Fonts/impact.ttf', 'C:/Windows/Fonts/arialbd.ttf', 'C:/Windows/Fonts/arial.ttf',
  '/System/Library/Fonts/Supplemental/Impact.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
];

export function findFont(preferred) {
  for (const p of [preferred, ...FONT_CANDIDATES]) if (p && fs.existsSync(p)) return p;
  return null;
}

// Copia a fonte para dir/name, para usar caminho relativo no ffmpeg (evita escapar "C:").
export function ensureFont(dir, preferred, name = 'font.ttf') {
  const src = findFont(preferred);
  if (!src) return false;
  const dst = path.join(dir, name);
  if (path.resolve(src) !== path.resolve(dst)) fs.copyFileSync(src, dst);
  return true;
}

// Folha de contato (grade de miniaturas). Com label=true, carimba o tempo em cada quadro.
export async function contactSheet(file, outPattern, { fps, cols, rows, width = 320, crop = '', label = true, cwd }) {
  const base = [crop, `fps=${fps}`, `scale=${width}:-2`].filter(Boolean);
  const tile = `tile=${cols}x${rows}:padding=4:margin=4`;
  const withLabel = [...base, "drawtext=fontfile=font.ttf:text='%{pts\\:hms}':x=4:y=4:fontsize=16:fontcolor=yellow:box=1:boxcolor=black@0.7", tile];
  const args = (vf) => ['-i', file, '-an', '-vf', vf.join(','), '-q:v', '3', '-y', outPattern];
  if (label && cwd && fs.existsSync(path.join(cwd, 'font.ttf'))) {
    const r = await ffmpeg(args(withLabel), { cwd, allowFail: true });
    if (r.code === 0) return true;
  }
  await ffmpeg(args([...base, tile]), { cwd });
  return false;
}

// ---------- Áudio: onsets, tempo e beats ----------
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

export function onsetEnvelope(pcm, sr) {
  const n = 1024, hop = 256;
  const frames = Math.max(0, Math.floor((pcm.length - n) / hop) + 1);
  const win = new Float64Array(n);
  for (let i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  const prev = new Float64Array(n / 2);
  const full = new Float64Array(frames), low = new Float64Array(frames);
  const re = new Float64Array(n), im = new Float64Array(n);
  const lowBins = Math.max(2, Math.round((200 * n) / sr)); // até ~200 Hz: bumbo/baixo
  for (let f = 0; f < frames; f++) {
    const off = f * hop;
    for (let i = 0; i < n; i++) { re[i] = pcm[off + i] * win[i]; im[i] = 0; }
    fft(re, im);
    let flux = 0, lflux = 0;
    for (let k = 1; k < n / 2; k++) {
      const m = Math.log1p(100 * Math.hypot(re[k], im[k]));
      const d = m - prev[k];
      if (d > 0 && f > 0) { flux += d; if (k <= lowBins) lflux += d; }
      prev[k] = m;
    }
    full[f] = flux; low[f] = lflux;
  }
  // Graves pesam mais: o bumbo costuma marcar o tempo, o hi-hat o contratempo.
  const sdOf = (a) => { let m = 0; for (const v of a) m += v; m /= a.length || 1; let s = 0; for (const v of a) s += (v - m) ** 2; return Math.sqrt(s / (a.length || 1)) || 1; };
  const sF = sdOf(full), sL = sdOf(low);
  const raw = new Float64Array(frames);
  for (let i = 0; i < frames; i++) raw[i] = full[i] / sF + 1.5 * (low[i] / sL);
  const fps = sr / hop;
  const w = Math.max(1, Math.round(fps * 0.25));
  const pre = new Float64Array(frames + 1);
  for (let i = 0; i < frames; i++) pre[i + 1] = pre[i] + raw[i];
  const env = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    const a = Math.max(0, i - w), b = Math.min(frames, i + w + 1);
    env[i] = Math.max(0, raw[i] - (pre[b] - pre[a]) / (b - a));
  }
  let mean = 0; for (const v of env) mean += v; mean /= frames || 1;
  let sd = 0; for (const v of env) sd += (v - mean) ** 2; sd = Math.sqrt(sd / (frames || 1)) || 1;
  for (let i = 0; i < frames; i++) env[i] /= sd;
  return { env, fps, offset: n / 2 / sr };
}

export function estimateTempo(env, fps) {
  const N = env.length;
  const lo = Math.floor((fps * 60) / 200), hi = Math.ceil((fps * 60) / 60);
  const scores = [];
  for (let lag = lo; lag <= hi; lag++) {
    let s = 0;
    for (let i = lag; i < N; i++) s += env[i] * env[i - lag];
    s /= Math.max(1, N - lag);
    const bpm = (60 * fps) / lag;
    scores.push({ lag, s: s * Math.exp(-0.5 * (Math.log2(bpm / 120) / 1.0) ** 2) });
  }
  let bi = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i].s > scores[bi].s) bi = i;
  let lag = scores[bi]?.lag || Math.round(fps / 2);
  if (bi > 0 && bi < scores.length - 1) {
    const a = scores[bi - 1].s, b = scores[bi].s, c = scores[bi + 1].s, den = a - 2 * b + c;
    if (den !== 0) lag += (0.5 * (a - c)) / den;
  }
  return { bpm: (60 * fps) / lag, period: lag };
}

// Rastreamento de beats por programação dinâmica (Ellis, 2007).
export function trackBeats(env, fps, period, offset = 0, tightness = 100) {
  const N = env.length;
  if (!N) return [];
  const score = new Float64Array(N), back = new Int32Array(N).fill(-1);
  const lo = Math.max(1, Math.round(period / 2)), hi = Math.round(period * 2);
  for (let i = 0; i < N; i++) {
    let best = -Infinity, bj = -1;
    for (let j = i - hi; j <= i - lo; j++) {
      if (j < 0) continue;
      const c = score[j] - tightness * Math.log((i - j) / period) ** 2;
      if (c > best) { best = c; bj = j; }
    }
    if (bj >= 0 && best > 0) { score[i] = env[i] + best; back[i] = bj; } else score[i] = env[i];
  }
  let end = N - 1;
  for (let i = Math.max(0, N - Math.round(period)); i < N; i++) if (score[i] > score[end]) end = i;
  const idx = [];
  for (let i = end; i >= 0; i = back[i]) idx.push(i);
  idx.reverse();
  return idx.map((i) => ({ t: i / fps + offset, strength: env[i] }));
}

export async function musicBeats(file) {
  const sr = 22050;
  const pcm = await decodePcm(file, sr);
  if (pcm.length < sr * 2) return { bpm: 0, beats: [], duration: pcm.length / sr };
  const { env, fps, offset } = onsetEnvelope(pcm, sr);
  const { bpm, period } = estimateTempo(env, fps);
  const beats = trackBeats(env, fps, period, offset);
  const maxS = Math.max(...beats.map((b) => b.strength), 1e-9);
  beats.forEach((b) => { b.strength = +(b.strength / maxS).toFixed(3); b.t = +b.t.toFixed(3); });
  return { bpm: +bpm.toFixed(1), beats, duration: pcm.length / sr };
}

// Energia por janela e "drops" (subida forte e sustentada de volume). O 1º drop costuma ser o melhor
// ponto para o vídeo começar (music.start = "drop").
export async function musicProfile(file) {
  const sr = 22050, pcm = await decodePcm(file, sr), win = Math.round(sr * 0.25);
  const e = [];
  for (let s = 0; s + win <= pcm.length; s += win) { let a = 0; for (let i = s; i < s + win; i++) a += pcm[i] * pcm[i]; e.push(Math.sqrt(a / win)); }
  const mx = Math.max(...e, 1e-9), en = e.map((v) => v / mx);
  const avg = (a, b) => { const s = en.slice(Math.max(0, a), Math.max(0, b)); return s.length ? s.reduce((x, y) => x + y, 0) / s.length : 0; };
  const drops = [];
  for (let i = 8; i < en.length - 8; i++) {
    const before = avg(i - 8, i), after = avg(i, i + 8); // 2 s antes vs 2 s depois
    if (after > 0.55 && after > before * 1.6 && (!drops.length || i * 0.25 - drops[drops.length - 1].t > 8)) drops.push({ t: +(i * 0.25).toFixed(2), before: +before.toFixed(2), after: +after.toFixed(2) });
  }
  return { duration: pcm.length / sr, energy: en.map((v) => +v.toFixed(2)), step: 0.25, drops };
}
// Refina o instante do drop: primeiro pico forte em ±1 s.
export async function findDrop(file) {
  const p = await musicProfile(file);
  return p.drops.length ? p.drops[0].t : 0;
}

// Picos de volume (tiros, explosões). Retorna [{t, v}] com v normalizado.
export function rmsPeaks(pcm, sr, max = 40) {
  const win = Math.round(sr * 0.01);
  const n = Math.floor(pcm.length / win);
  if (n < 3) return [];
  const rms = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < win; j++) { const x = pcm[i * win + j]; s += x * x; }
    rms[i] = Math.sqrt(s / win);
  }
  const sorted = Array.from(rms).sort((a, b) => a - b);
  const mx = sorted[n - 1] || 1e-9;
  const thr = Math.max(sorted[Math.floor(n * 0.97)], 0.3 * mx);
  const peaks = [];
  for (let i = 0; i < n; i++) {
    if (rms[i] < thr) continue;
    let isMax = true;
    for (let k = Math.max(0, i - 12); k <= Math.min(n - 1, i + 12); k++) if (rms[k] > rms[i]) { isMax = false; break; }
    if (isMax) peaks.push({ t: +(i * 0.01).toFixed(2), v: +(rms[i] / mx).toFixed(2) });
  }
  return peaks.sort((a, b) => b.v - a.v).slice(0, max).sort((a, b) => a.t - b.t);
}

// ---------- Kills do próprio jogador ----------
// No CS2, as linhas do killfeed em que VOCÊ mata têm moldura vermelha. Conta quantas caixas
// vermelhas há em cada quadro (linhas horizontais vermelhas / 2), suaviza com mediana de ~0,9 s
// e marca um kill sempre que esse número sobe. Deslocamento de linhas não muda a contagem.
export async function redKillfeedKills(file, kf, fps = 10) {
  const W = 366, H = 130;
  const vf = `fps=${fps},crop=iw*${kf.w}:ih*${kf.h}:iw*${kf.x}:ih*${kf.y},scale=${W}:${H}`;
  const r = await run(FFMPEG, ['-hide_banner', '-nostdin', '-v', 'error', '-hwaccel', 'auto', '-i', file, '-an', '-vf', vf, '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { binary: true });
  if (r.code !== 0) return { kills: [], counts: [] };
  const buf = r.stdout, fsz = W * H * 3, n = Math.floor(buf.length / fsz);
  const counts = new Array(n);
  for (let f = 0; f < n; f++) {
    const o = f * fsz;
    // Moldura = linha horizontal FINA (≤3 px aqui). Áreas vermelhas cheias (tela de morte, sangue) formam
    // faixas grossas e são ignoradas. Vermelho escurecido pelo net graph ainda conta.
    // Obs.: a tela de morte (tinta vermelha) às vezes gera um kill falso no fim do clipe; tentar filtrar
    // pela cor média do quadro derrubou kills reais em mapas avermelhados — confira o último kill visualmente.
    let lines = 0, run = 0;
    for (let y = 0; y <= H; y++) {
      let on = false;
      if (y < H) {
        let k = 0;
        for (let x = 0; x < W; x++) {
          const i = o + (y * W + x) * 3, rr = buf[i], g = buf[i + 1], b = buf[i + 2];
          if (rr > 95 && g < 0.45 * rr && b < 0.45 * rr && rr - g > 55) k++;
        }
        on = k >= 50 && k <= W * 0.95;
      }
      if (on) run++;
      else { if (run >= 1 && run <= 3) lines++; run = 0; }
    }
    counts[f] = Math.round(lines / 2);
  }
  const half = Math.round(fps * 0.45);
  const med = counts.map((_, i) => median(counts.slice(Math.max(0, i - half), Math.min(n, i + half + 1))));
  // O nível precisa se manter por ~0,8 s (linhas reais ficam vários segundos; sangue/flash atrás do HUD, não).
  const hold = Math.round(fps * 0.8);
  const smooth = med.map((_, i) => Math.min(...med.slice(i, Math.min(n, i + hold))));
  const kills = [];
  for (let i = 1; i < n; i++) {
    if (smooth[i] <= smooth[i - 1]) continue;
    // instante real: primeiro quadro bruto, perto daqui, que já atingiu o novo nível
    let j = i;
    for (let k = i - 1; k >= Math.max(0, i - Math.round(fps * 0.6)); k--) if (counts[k] >= smooth[i] && counts[k + 1] >= smooth[i]) j = k;
    for (let k = 0; k < smooth[i] - smooth[i - 1]; k++) kills.push(+(j / fps + k * 0.15).toFixed(2));
  }
  return { kills, counts };
}

// ---------- Codificação ----------
let nvencOk = null;
export async function canUseNvenc() {
  if (nvencOk !== null) return nvencOk;
  if (process.env.CS2HL_NO_GPU) return (nvencOk = false);
  const r = await run(FFMPEG, ['-hide_banner', '-nostdin', '-f', 'lavfi', '-i', 'color=black:s=256x256:d=0.2', '-c:v', 'h264_nvenc', '-f', 'null', '-']);
  return (nvencOk = r.code === 0);
}

export async function videoEncArgs({ preview = false, crf = 18 } = {}) {
  if (preview) return ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-pix_fmt', 'yuv420p'];
  if (await canUseNvenc()) return ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', String(crf + 2), '-b:v', '12M', '-maxrate', '16M', '-bufsize', '32M', '-pix_fmt', 'yuv420p'];
  return ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-pix_fmt', 'yuv420p'];
}

export function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

export function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); }
export function writeJson(p, obj) { fs.writeFileSync(p, JSON.stringify(obj, null, 2)); }

export function listVideos(target) {
  const st = fs.statSync(target);
  if (!st.isDirectory()) return [path.resolve(target)];
  return fs.readdirSync(target)
    .filter((f) => VIDEO_EXT.includes(path.extname(f).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((f) => path.resolve(target, f));
}

export function parseArgs(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) opt[k] = argv[++i];
      else opt[k] = true;
    } else pos.push(a);
  }
  return { pos, opt };
}
