#!/usr/bin/env node
// Analisa a VOD inteira e dá uma NOTA VIRAL (0–100) a cada momento candidato.
// A nota é uma ORDENAÇÃO POR SINAIS, não a probabilidade de viralizar — pesos em config.weights
// (padrão do estudo em references/viral-notes.md), recalibráveis com calibrate.mjs.
//   node analyze-vod.mjs <pasta-da-vod | id> [--top 12] [--no-killfeed] [--no-transcript] [--model large-v3-turbo] [--force]
// Sinais (por segundo): voz (volume na faixa de voz vs. a base do stream), chat (mensagens e emotes de reação,
// deslocados pelo atraso do chat), kills do POV (killfeed da cs2-highlight-editor), palavras-chave da fala
// (Whisper local), mudança brusca de cena. Saída: signals.json, candidates.json (+ transcript.json, kills.json).
import fs from 'node:fs';
import path from 'node:path';
import { L, DEFAULT_STYLE, SKILL_DIR, loadConfig, parseArgs, hms, clamp01, rollingMedian, ownKillfeedEvents } from './lib.mjs';

const { pos, opt } = parseArgs(process.argv.slice(2));
if (!pos[0]) { console.error('uso: node analyze-vod.mjs <pasta-da-vod|id> [--top 12] [--no-killfeed] [--no-transcript] [--force]'); process.exit(1); }
await L.checkTools();
const cfg = loadConfig();
const dir = fs.existsSync(pos[0]) ? path.resolve(pos[0]) : path.join(cfg.dataDir, String(pos[0]));
const src = L.readJson(path.join(dir, 'source.json'));
const media = src.proxy || src.file;
const D = Math.floor(src.duration || (await L.probe(media)).duration);
const T = (f) => path.join(dir, f);
const done = (f) => fs.existsSync(T(f)) && !opt.force;
const t0 = Date.now();
const log = (m) => console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${m}`);
log(`${src.title} — ${hms(D)}`);

// ---------- 1. Voz/volume (faixa 200–3500 Hz, 2 valores por segundo) ----------
async function audioSeries() {
  if (done('_audio.txt') === false) {
    const map = cfg.micTrack != null && src.kind === 'local' ? `0:a:${cfg.micTrack}` : '0:a:0';
    await L.ffmpeg(['-i', media, '-map', map, '-vn', '-af', 'highpass=f=200,lowpass=f=3500,aresample=8000,asetnsamples=n=4000:p=0,astats=metadata=1:reset=1,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level:file=_audio.txt', '-f', 'null', '-'], { cwd: dir });
  }
  const v = new Array(D).fill(-90);
  let t = null;
  for (const line of fs.readFileSync(T('_audio.txt'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/pts_time:([\d.]+)/); if (m) { t = Math.floor(+m[1]); continue; }
    const k = line.match(/RMS_level=(-?[\d.]+|-inf)/);
    if (k && t !== null && t < D) v[t] = Math.max(v[t], k[1] === '-inf' ? -90 : +k[1]);
  }
  // Silêncio digital (mic com gate, jogo mudo) vira -90 dB e derruba a base: piso de -60 dB.
  return v.map((x) => Math.max(x, -60));
}

// ---------- 2. Cena (2 qps) + recorte do killfeed (10 qps) numa só decodificação ----------
async function videoPass() {
  const kf = cfg.killfeed || DEFAULT_STYLE.output.killfeed;
  const kfDir = T('_kf');
  const needKf = !opt['no-killfeed'] && (opt.force || (!fs.existsSync(T('kills.json')) && !fs.existsSync(kfDir)));
  if (done('_scene.txt') && !needKf) return;
  if (needKf) fs.mkdirSync(kfDir, { recursive: true });
  const fc = [`[0:v]split=2[a][b]`, `[a]fps=2,scale=160:-2,select='gte(scene,0)',metadata=mode=print:file=_scene.part[s]`];
  const outs = ['-map', '[s]', '-f', 'null', '-'];
  if (needKf) {
    fc.push(`[b]fps=10,crop=iw*${kf.w}:ih*${kf.h}:iw*${kf.x}:ih*${kf.y},scale=366:130,format=rgb24[k]`);
    outs.push('-map', '[k]', '-c:v', 'libx264rgb', '-qp', '0', '-preset', 'ultrafast', '-g', '10', '-force_key_frames', 'expr:gte(t,n_forced*300)',
      '-f', 'segment', '-segment_time', '300', '-reset_timestamps', '1', '_kf/kf_%04d.mkv');
  } else fc[0] = '[0:v]null[a]';
  log(needKf ? 'Lendo o vídeo: mudança de cena + killfeed (a parte mais demorada)...' : 'Lendo o vídeo: mudança de cena...');
  await L.ffmpeg(['-hwaccel', 'auto', '-i', media, '-an', '-filter_complex', fc.join(';'), ...outs], { cwd: dir });
  fs.renameSync(T('_scene.part'), T('_scene.txt')); // só vira _scene.txt se o ffmpeg terminou (interrupção não deixa arquivo pela metade)
}
function sceneSeries() {
  const s = new Array(D).fill(0);
  if (!fs.existsSync(T('_scene.txt'))) return s;
  for (const f of L.parseMetadata(fs.readFileSync(T('_scene.txt'), 'utf8'))) { const i = Math.floor(f.t); if (i < D) s[i] = Math.max(s[i], f['lavfi.scene_score'] || 0); }
  return s;
}
async function killTimes() {
  if (opt['no-killfeed']) return [];
  // Lista conferida à mão (passo 2 do SKILL.md) tem prioridade sobre a detecção automática
  if (fs.existsSync(T('kills_verificados.json'))) { log('Usando kills_verificados.json (conferidos visualmente)'); return L.readJson(T('kills_verificados.json')).kills; }
  if (done('kills.json')) return L.readJson(T('kills.json')).kills;
  const files = fs.readdirSync(T('_kf')).filter((f) => f.endsWith('.mkv')).sort();
  const kills = [], deaths = [];
  for (const [i, f] of files.entries()) {
    // detector próprio (lib.mjs): separa a linha do seu kill (fundo escuro) da sua morte (fundo vermelho) e ignora menus
    const r = await ownKillfeedEvents(path.join(T('_kf'), f), 10);
    kills.push(...r.kills.map((k) => +(i * 300 + k).toFixed(2)));
    deaths.push(...r.deaths.map((k) => +(i * 300 + k).toFixed(2)));
  }
  L.writeJson(T('kills.json'), { _sobre: 'Kills do POV (linha do killfeed com moldura vermelha e fundo escuro; inclui assistências) e mortes (fundo vermelho), em segundos da VOD. Medido numa live de 1h33: ~90% dos kills achados, ~15% de falsos (quase todos na tela de morte). Confira os candidatos.', kills, deaths });
  fs.rmSync(T('_kf'), { recursive: true, force: true });
  return kills;
}

// ---------- 3. Chat ----------
const BOTS = /^(nightbot|streamelements|streamlabs|moobot|fossabot|wizebot|soundalerts|sery_bot|botrix.*|.*bot)$/i;
const REACT = [
  [/\b(KEKW|KEKL|LUL|LULW|OMEGALUL|ICANT|LMAO|LOL|pepeLaugh|Kappa)\b|k{3,}|ha(ha)+|rs(rs)+|😂|🤣|💀/i, 1.0, 'risada'],
  [/\b(Pog|PogChamp|POGGERS|PogU|POG|WOW|GIGACHAD|Clap|EZ|W{2,}|insano|monstro|absurdo|brabo|braboo+)\b|🔥|😱|😳/i, 0.9, 'hype'],
  [/\?{3,}|\b(WHAT|WTF|como assim|oq|oque)\b/i, 0.7, 'espanto'],
  [/\b(clip|clipa|clipe|clippp*|clip it)\b/i, 1.2, 'clip'],
  [/\b(F|RIP|NotLikeThis|BibleThump|Sadge)\b/, 0.6, 'fail'],
];
function chatSeries() {
  const rate = new Array(D).fill(0), react = new Array(D).fill(0), why = Array.from({ length: D }, () => ({}));
  if (!src.chat || !fs.existsSync(src.chat)) return null;
  const c = L.readJson(src.chat).comments || [];
  if (c.length < 20) return null;
  for (const m of c) {
    const name = m.commenter?.name || m.commenter?.display_name || '';
    if (BOTS.test(name) || (m.message?.user_badges || []).some((b) => b._id === 'bot-badge' || b._id === 'broadcaster')) continue;
    if (cfg.channel && name.toLowerCase() === String(cfg.channel).toLowerCase()) continue; // o próprio streamer não é reação do chat
    const i = Math.floor(m.content_offset_seconds); if (i < 0 || i >= D) continue;
    rate[i]++;
    const body = m.message?.body || '';
    for (const [re, w, tag] of REACT) if (re.test(body)) { react[i] += w; why[i][tag] = (why[i][tag] || 0) + 1; }
  }
  return { rate, react, why, n: c.length };
}

// ---------- 4. Fala ----------
const KW = [
  [/n[ãa]o acredito|inacredit[áa]vel|imposs[íi]vel|como assim|que isso|mano do c[ée]u|meu deus|nossa senhora|socorro/i, 1.0],
  [/clipa|clip(ou)?\b|grava isso|olha isso|olha o que|viram isso/i, 1.2],
  [/caralho|porra|puta que|vai tomar|filho da/i, 0.6],
  [/\bace\b|clutch|um contra (dois|tr[êe]s|quatro|cinco)|1v[2-5]|\b[2345] ?k\b|quatro kills|cinco kills/i, 1.0],
  [/k{3,}|ha(ha)+|risos|\(risada\)/i, 0.9],
  [/insano|absurdo|monstro|brabo|que sorte|que azar|morri|n[ãa]o!|vai vai|pegou|nem vi/i, 0.5],
  [/no way|oh my god|what the|let'?s go|holy/i, 0.8],
];
async function transcript() {
  if (opt['no-transcript']) return null;
  if (!done('transcript.json')) {
    log(`Transcrevendo a fala com Whisper (${opt.model || cfg.whisperModel}, GPU se houver)...`);
    const args = ['run', '--quiet', '--no-build', path.join(SKILL_DIR, 'scripts', 'transcribe.py'), media, '--out', T('transcript.json'), '--lang', cfg.lang, '--model', opt.model || cfg.whisperModel, '--ffmpeg', L.FFMPEG];
    if (cfg.micTrack != null && src.kind === 'local') args.push('--track', String(cfg.micTrack));
    const r = await L.run('uv', args);
    if (r.code !== 0) { console.log(`AVISO: transcrição falhou (${r.stderr.slice(-400)}). Seguindo sem fala.`); return null; }
  }
  return L.readJson(T('transcript.json'));
}
function speechSeries(tr) {
  const kw = new Array(D).fill(0), speech = new Array(D).fill(0), hits = Array.from({ length: D }, () => []);
  if (!tr) return null;
  for (const s of tr.segments) {
    for (let i = Math.floor(s.start); i <= Math.min(D - 1, Math.floor(s.end)); i++) speech[i] = 1;
    const i = Math.min(D - 1, Math.floor(s.start));
    for (const [re, w] of KW) { const m = s.text.match(re); if (m) { kw[i] += w; hits[i].push(m[0].toLowerCase()); } }
    const ex = (s.text.match(/!/g) || []).length; if (ex) kw[i] += Math.min(0.6, 0.2 * ex);
    const words = s.text.toLowerCase().match(/[\p{L}]{3,}/gu) || [];
    const rep = Math.max(0, ...Object.values(words.reduce((o, w) => ((o[w] = (o[w] || 0) + 1), o), {})));
    if (rep >= 3) { kw[i] += 0.6; hits[i].push(`"${words.find((w) => words.filter((x) => x === w).length === rep)}" ×${rep}`); }
  }
  return { kw, speech, hits };
}

// ---------- Execução ----------
const [voiceDb] = await Promise.all([audioSeries(), videoPass()]);
log('Áudio e vídeo lidos.');
const scene = sceneSeries();
const kills = await killTimes();
log(`Kills do POV detectados: ${kills.length}`);
const chat = chatSeries();
const tr = await transcript();
const sp = speechSeries(tr);
log(`Chat: ${chat ? chat.n + ' mensagens' : 'sem chat'} · Fala: ${tr ? tr.segments.length + ' trechos' : 'sem transcrição'}`);

// Normalização: voz = dB acima da mediana móvel de 2 min, em unidades de desvio robusto
// A base não desce mais que 8 dB abaixo da mediana da live inteira (trechos com muito silêncio não inflam a fala seguinte)
const vGlobal = L.median(voiceDb.filter((x) => x > -60)) ?? -40;
const vBase = rollingMedian(voiceDb, 120).map((b) => Math.max(b, vGlobal - 8));
const vDev = voiceDb.map((v, i) => v - vBase[i]);
// Escala fixa: 1 unidade = 4 dB acima da base (o desvio robusto estoura com lives que alternam silêncio e fala). +12 dB = 3, +28 dB = 7.
const vMad = 4;
const voiceZ = vDev.map((d) => d / vMad);

// Chat: suaviza 5 s, z vs. mediana móvel de 5 min; atraso estimado por correlação com a voz
let chatZ = null, reactZ = null, lag = cfg.chatLag ?? 8;
// Chat fraco (< 1 msg/min) não é sinal: fica de fora e o peso vai para os outros
const chatOk = chat && chat.n >= D / 60;
if (chat && !chatOk) log(`Chat fraco demais (${chat.n} msgs em ${hms(D)}): sinal de chat ignorado nesta VOD`);
if (chatOk) {
  const sm = (a, w) => a.map((_, i) => L.mean(a.slice(Math.max(0, i - (w >> 1)), i + (w >> 1) + 1)));
  // Piso no desvio: num chat fraco a mediana é 0 e uma mensagem solta viraria "pico". 0,1/s ≈ 1 msg a mais em 10 s.
  const z = (a) => { const b = rollingMedian(a, 300); const d = a.map((v, i) => v - b[i]); const m = Math.max(0.1, L.median(d.map(Math.abs)) * 1.4826); return d.map((x) => x / m); };
  const rz = z(sm(chat.rate, 5)), ez = z(sm(chat.react, 5));
  // Atraso só é estimável com chat ativo (≥ 1 msg/min em média); senão fica o padrão
  if (cfg.chatLag == null && chat.n >= D / 60) {
    let best = -1;
    for (let l = 2; l <= 25; l++) {
      let s = 0, n = 0;
      for (let i = 0; i + l < D; i++) if (voiceZ[i] > 2) { s += rz[i + l]; n++; }
      const c = n ? s / n : 0;
      if (c > best) { best = c; lag = l; }
    }
    if (best < 0.3) lag = 8;
  }
  chatZ = rz.map((_, i) => rz[Math.min(D - 1, i + lag)]);
  reactZ = ez.map((_, i) => ez[Math.min(D - 1, i + lag)]);
  log(`Atraso estimado do chat: ${lag} s`);
}

// Ativação para achar picos (sem kills; kills entram como âncoras próprias)
const W = { ...cfg.weights };
const act = new Array(D).fill(0);
for (let i = 0; i < D; i++) {
  let a = W.voice * clamp01((voiceZ[i] - 1.5) / 5) + W.scene * clamp01(scene[i] / 0.5);
  if (chatZ) a += W.chat * clamp01((0.6 * chatZ[i] + 0.4 * reactZ[i] - 1) / 5);
  if (sp) a += W.keywords * clamp01(L.mean(sp.kw.slice(Math.max(0, i - 3), i + 4)) * 2);
  act[i] = a;
}
// Rajadas de kills (kills a menos de 25 s um do outro = mesma rajada/round)
const bursts = [];
for (const k of [...kills].sort((a, b) => a - b)) {
  const b = bursts.at(-1);
  if (b && k - b.at(-1) <= 25) b.push(k); else bursts.push([k]);
}
const anchors = [];
for (const b of bursts) anchors.push({ t: Math.round(b.at(-1)), kind: 'kills' });
const NMS = 40;
const order = act.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
for (const [v, i] of order) {
  if (v < 0.08 || anchors.length > 400) break;
  if (anchors.some((a) => Math.abs(a.t - i) < NMS)) continue;
  anchors.push({ t: i, kind: 'pico' });
}

const killScore = (n) => [0, 0.15, 0.4, 0.65, 0.85, 1][Math.min(5, n)];
const win = (a, s, e) => a.slice(Math.max(0, Math.floor(s)), Math.min(D, Math.ceil(e) + 1));
const maxOf = (a) => (a.length ? Math.max(...a) : 0);
const cands = [];
for (const an of anchors) {
  // ápice: kill final da rajada (ou o maior pico de voz logo depois, se for reação) — senão o pico de voz
  const near = kills.filter((k) => k >= an.t - 30 && k <= an.t + 3);
  const lastKill = near.length ? Math.max(...near) : null;
  let apex = an.t;
  const vw = (s, e) => { let bi = Math.max(0, Math.floor(s)); for (let i = bi; i <= Math.min(D - 1, e); i++) if (voiceZ[i] > voiceZ[bi]) bi = i; return bi; };
  if (lastKill !== null) { const r = vw(lastKill - 1, lastKill + 5); apex = voiceZ[r] > 3 ? r : Math.round(lastKill); }
  else apex = vw(an.t - 8, an.t + 8);
  const nK = kills.filter((k) => k >= apex - 30 && k <= apex + 3).length;
  const c = {
    kills: nK > 5 ? 0.1 : killScore(nK), // mais de 5 kills em 30 s não existe num round: aquecimento ou deathmatch
    voice: clamp01((maxOf(win(voiceZ, apex - 3, apex + 6)) - 2) / 5),
    chat: chatZ ? clamp01((0.6 * maxOf(win(chatZ, apex - 2, apex + 12)) + 0.4 * maxOf(win(reactZ, apex - 2, apex + 12)) - 1.5) / 5) : null,
    keywords: sp ? clamp01(win(sp.kw, apex - 10, apex + 8).reduce((a, b) => a + b, 0) / 3) : null,
    scene: clamp01(maxOf(win(scene, apex - 5, apex + 2)) / 0.5),
  };
  // Pesos renormalizados entre os sinais disponíveis
  const avail = Object.keys(W).filter((k) => c[k] !== null && !(k === 'kills' && opt['no-killfeed']));
  const wsum = avail.reduce((s, k) => s + W[k], 0);
  let score = avail.reduce((s, k) => s + (W[k] / wsum) * c[k], 0) * 100;
  const strong = avail.filter((k) => c[k] >= 0.6).length;
  const bonus = [];
  if (strong >= 2) { score += 5; bonus.push('+5 sinais juntos'); }
  // janela do clipe
  const P = cfg.clip;
  let start = apex - P.pre, end = apex + P.post;
  const firstKill = near.length ? Math.min(...near) : null;
  if (firstKill !== null && firstKill - 3 < start) start = Math.max(firstKill - 3, end - P.max);
  if (sp && tr) { // começa no início de uma frase e termina depois da reação
    const segs = tr.segments;
    const st = segs.filter((s) => s.start >= apex - P.pre - 6 && s.start <= apex - 5).sort((a, b) => Math.abs(a.start - (apex - P.pre)) - Math.abs(b.start - (apex - P.pre)))[0];
    if (st && (firstKill === null || st.start <= firstKill - 2)) start = st.start - 0.2;
    const en = segs.filter((s) => s.end >= apex + 3 && s.end <= apex + P.post + 4).sort((a, b) => b.end - a.end)[0];
    if (en) end = Math.max(end, en.end + 0.4);
  }
  if (end - start < P.min) start = end - P.min;
  if (end - start > P.max) start = end - P.max;
  start = Math.max(0, start); end = Math.min(D, end);
  if (sp && !win(sp.speech, start, start + 2).some(Boolean) && maxOf(win(voiceZ, start, start + 2)) < 1.5) { score -= 10; bonus.push('−10 começo parado'); }
  score = Math.max(0, Math.min(100, Math.round(score)));
  // motivos legíveis
  const why = [];
  if (nK > 5) why.push(`${nK} kills em 30 s: provável aquecimento/deathmatch`); else if (nK >= 2) why.push(`${nK >= 5 ? 'ACE' : nK + 'K'} (${nK} kills em ${Math.round(Math.max(...near) - Math.min(...near))} s)`); else if (nK === 1) why.push('1 kill');
  const vPk = maxOf(win(vDev, apex - 3, apex + 6));
  if (c.voice >= 0.2) why.push(`voz +${vPk.toFixed(0)} dB sobre a base`);
  if (chat && c.chat >= 0.15) {
    const tags = {}; for (let i = Math.max(0, apex - 2 + lag); i <= Math.min(D - 1, apex + 12 + lag); i++) for (const [k, n] of Object.entries(chat.why[i])) tags[k] = (tags[k] || 0) + n;
    const nWin = win(chat.rate, apex + lag - 2, apex + lag + 12).reduce((a, b) => a + b, 0);
    const normal = (chat.n / D) * 15;
    why.push(`chat ${nWin} msgs em 15 s (normal ${normal < 1 ? normal.toFixed(1) : Math.round(normal)})${Object.keys(tags).length ? ' (' + Object.entries(tags).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ') + ')' : ''}`);
  }
  const quoteSegs = tr ? tr.segments.filter((s) => s.end >= apex - 6 && s.start <= apex + 6) : [];
  const quote = quoteSegs.map((s) => s.text).join(' ').slice(0, 140);
  if (sp && c.keywords >= 0.2) why.push(`fala: ${[...new Set(win(sp.hits, apex - 10, apex + 8).flat())].slice(0, 3).map((h) => `"${h}"`).join(', ')}`);
  if (c.scene >= 0.6) why.push('mudança brusca de cena');
  cands.push({ apex, start: +start.toFixed(2), end: +end.toFixed(2), duration: +(end - start).toFixed(1), score, components: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v === null ? null : +v.toFixed(2)])),
    kills: near.length ? near.length : 0, killTimes: near, bonus, reasons: why.length ? why : ['pico geral de atividade'], quote, kind: nK >= 2 ? 'jogada' : 'reacao' });
}
// remove sobreposição > 50% (fica a de maior nota) e ordena
cands.sort((a, b) => b.score - a.score);
const keep = [];
for (const c of cands) if (!keep.some((k) => Math.max(0, Math.min(k.end, c.end) - Math.max(k.start, c.start)) > 0.5 * Math.min(k.duration, c.duration))) keep.push(c);
const top = keep.slice(0, Number(opt.top || Math.max(12, cfg.topN * 2)));
top.forEach((c, i) => { c.rank = i + 1; c.title = autoTitle(c); });

function autoTitle(c) {
  const emoji = c.reasons.some((r) => /risada/.test(r)) || /k{3,}|haha/i.test(c.quote) ? '😂' : /morri|n[ãa]o!|azar/i.test(c.quote) ? '💀' : '😳';
  if (c.kills >= 5) return `ACE ${emoji}`;
  const line = (c.quote.split(/(?<=[.!?])\s+/).find((s) => s.length >= 8 && s.length <= 45) || '').replace(/[.]+$/, '');
  if (c.kills >= 3) return `${c.kills}K${line ? ' — ' + line.toLowerCase() : ''} ${emoji}`;
  return line ? `${line} ${emoji}` : `olha isso ${emoji}`;
}

const signalsSummary = { duration: D, chatLag: chatOk ? lag : null, chatMessages: chat?.n || 0, kills: kills.length, killBursts: bursts.length, transcript: !!tr,
  voiceBaseDb: +L.median(voiceDb).toFixed(1), weights: W, signalsUsed: ['kills', 'voice', chatOk && 'chat', tr && 'keywords', 'scene'].filter(Boolean) };
L.writeJson(T('signals.json'), { ...signalsSummary, series: { voiceZ: voiceZ.map((v) => +v.toFixed(2)), chatZ: chatZ?.map((v) => +v.toFixed(2)) || null, scene: scene.map((v) => +v.toFixed(2)), act: act.map((v) => +v.toFixed(3)) } });
L.writeJson(T('candidates.json'), { _sobre: 'Nota 0–100 = ordenação por sinais (não é probabilidade). Edite title/start/end ou remova itens antes do make-clips.', vod: { key: src.key, vodId: src.vodId, title: src.title, url: src.url || null }, ...signalsSummary, candidates: top });
log(`${top.length} candidatos → ${T('candidates.json')}`);
for (const c of top.slice(0, cfg.topN)) console.log(`#${c.rank}  ${String(c.score).padStart(3)}  ${hms(c.start)}–${hms(c.end)} (${c.duration}s)  ${c.reasons.join(' · ')}  | "${c.title}"`);
