#!/usr/bin/env node
// Monta o plano de edição (plan.json) a partir do estilo, dos kills confirmados e da música.
// Uso: node build-plan.mjs --style estilo.json --kills kills.json [--music musica.mp3] [--out plan.json]
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as L from './lib.mjs';
import { DEFAULT_STYLE, deepMerge } from './defaults.mjs';

const { opt } = L.parseArgs(process.argv.slice(2));
if (!opt.style || !opt.kills) { console.error('uso: node build-plan.mjs --style estilo.json --kills kills.json [--music musica.mp3] [--out plan.json]'); process.exit(1); }
await L.checkTools();

const stylePath = path.resolve(opt.style);
const killsPath = path.resolve(opt.kills);
const styleDir = path.dirname(stylePath), killsDir = path.dirname(killsPath);
// "preset": "zuhn" (ou caminho de .json) → padrão ← preset ← estilo do usuário.
const userStyle = L.readJson(stylePath);
let presetStyle = null;
if (userStyle.preset) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pp = [path.resolve(styleDir, userStyle.preset), path.join(here, '..', 'presets', `${userStyle.preset}.json`)].find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
  if (!pp) { console.error(`ERRO: preset "${userStyle.preset}" não encontrado (veja a pasta presets/ da skill).`); process.exit(1); }
  presetStyle = L.readJson(pp);
  console.log(`Preset: ${path.basename(pp, '.json')}`);
}
const style = deepMerge(deepMerge(DEFAULT_STYLE, presetStyle || {}), userStyle);
const killsDoc = L.readJson(killsPath);
const res = (p, base) => (p ? path.resolve(base, p) : null);

const musicFile = res(opt.music, process.cwd()) || res(style.music.file, styleDir);
for (const [k, v] of Object.entries({ musica: musicFile, intro: res(style.intro, styleDir), outro: res(style.outro, styleDir), logo: res(style.logo?.file, styleDir), lut: res(style.color.lut, styleDir), fonte: res(style.text.font, styleDir) })) {
  if (v && !fs.existsSync(v)) { console.error(`ERRO: arquivo de ${k} não encontrado: ${v}`); process.exit(1); }
}

// ---- Beats da música ----
let beats = null, beatStrength = [], musicOffset = 0, bpm = 0, musicDuration = 0;
// music.start = "drop": começa de modo que o 1º kill caia no 1º drop da música.
if (musicFile && style.music.start === 'drop') {
  const drop = await L.findDrop(musicFile);
  style.music.start = Math.max(0, +(drop - style.pacing.preRoll).toFixed(2));
  console.log(`Drop da música em ${drop}s → música começa em ${style.music.start}s`);
}
if (musicFile && style.pacing.beatSync) {
  console.log('Detectando beats da música...');
  const mb = await L.musicBeats(musicFile);
  bpm = mb.bpm; musicDuration = mb.duration;
  const start = Number(style.music.start) || 0;
  const first = mb.beats.find((b) => b.t >= start - 0.02);
  musicOffset = first ? first.t : start;
  beats = mb.beats.filter((b) => b.t >= musicOffset).map((b) => +(b.t - musicOffset).toFixed(3));
  beatStrength = mb.beats.filter((b) => b.t >= musicOffset).map((b) => b.strength);
  console.log(`  ~${bpm} BPM, ${beats.length} beats a partir de ${musicOffset.toFixed(2)}s`);
} else if (musicFile) {
  musicOffset = Number(style.music.start) || 0;
  musicDuration = (await L.probe(musicFile)).duration;
}

// ---- Funções de tempo (origem → saída) ----
function makePieces(s, e, slows) {
  const pcs = [];
  let cur = s;
  for (const r of slows) {
    if (r.b <= s || r.a >= e) continue;
    const a = Math.max(r.a, s), b = Math.min(r.b, e);
    if (a > cur) pcs.push({ a: cur, b: a, speed: 1 });
    pcs.push({ a: Math.max(a, cur), b, speed: r.speed });
    cur = b;
  }
  if (e > cur) pcs.push({ a: cur, b: e, speed: 1 });
  return pcs.filter((p) => p.b - p.a > 1e-3);
}
const outDur = (pcs) => pcs.reduce((acc, p) => acc + (p.b - p.a) / p.speed, 0);
function outTime(pcs, t) {
  let o = 0;
  for (const p of pcs) {
    if (t <= p.a) break;
    o += (Math.min(t, p.b) - p.a) / p.speed;
    if (t <= p.b) break;
  }
  return o;
}
function bisect(fn, lo, hi, target, increasing) {
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2, v = fn(mid);
    if ((v < target) === increasing) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
const pickRule = (rule, i, n, kill) => ({ all: true, first: i === 0, last: i === n - 1, headshots: !!kill.headshot }[rule] || false);
const wants = (name, i, n, kill) => (kill.fx && name in kill.fx ? !!kill.fx[name] : pickRule(style.effects[name]?.on, i, n, kill));

// ---- Montagem dos segmentos ----
const P = style.pacing;
const segments = [];
let T = 0;
const nClips = (killsDoc.clips || []).length;
for (const [ci, c] of (killsDoc.clips || []).entries()) {
  const file = res(c.file, killsDir);
  if (!file || !fs.existsSync(file)) { console.warn(`AVISO: clipe não encontrado, pulando: ${c.file}`); continue; }
  const info = await L.probe(file);
  const dur = info.duration;
  // Arco de energia (pacing.arc): jogadas mais longas no começo, mais curtas rumo ao clímax.
  const m = P.arc ? 1.25 - 0.45 * (ci / Math.max(1, nClips - 1)) : 1;
  const Pc = { ...P, preRoll: P.preRoll * m, postRoll: P.postRoll * m };
  let allKills = (c.kills || []).filter((k) => Number.isFinite(k.t) && k.t >= 0 && k.t <= dur).sort((a, b) => a.t - b.t);
  if (!allKills.length) { console.warn(`AVISO: ${path.basename(file)} sem kills; usando 60% do clipe como momento principal.`); allKills = [{ t: dur * 0.6 }]; }
  const n = allKills.length;
  // Kills distantes (> pacing.maxGap) viram trechos separados do mesmo clipe: corta o "tempo morto".
  const groups = [];
  allKills.forEach((k, i) => {
    const g = groups[groups.length - 1];
    if (g && k.t - g[g.length - 1].k.t <= P.maxGap) g.push({ k, i }); else groups.push([{ k, i }]);
  });
  let prevEnd = 0;
  for (const [gi, grp] of groups.entries()) {
  const kills = grp.map((x) => x.k), idxOf = grp.map((x) => x.i);
  const lastGroup = gi === groups.length - 1;
  const k1 = kills[0].t, kn = kills[kills.length - 1].t;
  const lo = prevEnd;
  const hi = lastGroup ? dur : Math.max(kn + 0.2, groups[gi + 1][0].k.t - P.minPreRoll);

  // Faixas de câmera lenta
  const sm = style.effects.slowmo;
  const slows = [];
  kills.forEach((k, j) => {
    const i = idxOf[j];
    if (!wants('slowmo', i, n, k)) return;
    const a = Math.max(0, k.t - sm.before), b = Math.min(dur, k.t + sm.after);
    const last = slows[slows.length - 1];
    if (last && a <= last.b) { last.b = Math.max(last.b, b); last.speed = Math.min(last.speed, sm.speed); }
    else slows.push({ a, b, speed: sm.speed });
  });
  // Rampa suave (slowmo.ease): degrau intermediário antes do slow, em vez de troca seca de velocidade.
  if (sm.ease) {
    const easeIn = [];
    slows.forEach((r, i) => {
      const a = Math.max(i ? slows[i - 1].b : 0, r.a - 0.12);
      if (r.a - a > 0.03) easeIn.push({ a, b: r.a, speed: +((1 + r.speed) / 2).toFixed(3) });
    });
    slows.push(...easeIn);
    slows.sort((x, y) => x.a - y.a);
  }
  // "Velocity": depois do slow-mo, acelera (ramp out) — o vai-e-vem típico de edits de montagem.
  if (sm.rampOut && sm.rampOut.speed > 1) {
    const base = slows.filter((r) => r.speed === sm.speed);
    const fast = base.map((r) => ({ a: r.b, b: Math.min(dur, r.b + (sm.rampOut.duration || 0.4)), speed: sm.rampOut.speed }));
    slows.push(...fast.filter((f) => f.b - f.a > 0.05 && !slows.some((s) => s.a < f.b && s.b > f.a)));
    slows.sort((x, y) => x.a - y.a);
  }

  // Início: o 1º kill cai num beat
  const preOut = (s) => outTime(makePieces(s, k1, slows), k1);
  const maxPre = preOut(lo);
  let pre = Math.min(Pc.preRoll, maxPre);
  if (beats) {
    let best = null;
    for (const b of beats) {
      const d = b - T;
      if (d < P.minPreRoll - 1e-6) continue;
      if (d > Pc.preRoll * 2.2 + 0.5) break;
      if (d > maxPre + 1e-6) continue;
      if (!best || Math.abs(d - Pc.preRoll) < Math.abs(best - Pc.preRoll)) best = d;
    }
    if (best !== null) pre = best;
  }
  const s = pre >= maxPre - 1e-6 ? lo : bisect(preOut, lo, k1, pre, false);

  // Fim: termina num beat
  const durOut = (e) => outDur(makePieces(s, e, slows));
  const maxOut = durOut(hi);
  // Clipe com rótulo ("ACE", "4K"...): o trecho final precisa durar o rótulo inteiro.
  const post = lastGroup && c.label && style.text.labels ? Math.max(Pc.postRoll, style.text.labelDuration + 0.15) : Pc.postRoll;
  let target = Math.min(durOut(Math.min(hi, kn + post)), maxOut);
  if (beats) {
    const minEnd = durOut(Math.min(hi, kn + 0.15));
    const after = beats.map((b) => b - T).filter((d) => d >= target - 0.12 && d <= target + 1.2 && d <= maxOut + 1e-6);
    if (after.length) target = after[0];
    else {
      const before = beats.map((b) => b - T).filter((d) => d >= minEnd && d <= maxOut + 1e-6);
      if (before.length) target = before[before.length - 1];
    }
  }
  const e = target >= maxOut - 1e-6 ? hi : bisect(durOut, kn, hi, target, true);
  const pieces = makePieces(s, e, slows).map((p) => ({ a: +p.a.toFixed(3), b: +p.b.toFixed(3), speed: p.speed }));
  const D = outDur(pieces);
  const letterboxEv = style.effects.slowmo.letterbox
    ? pieces.filter((p) => p.speed < 1).map((p) => ({ type: 'letterbox', t: +outTime(pieces, p.a).toFixed(3), duration: +((p.b - p.a) / p.speed).toFixed(3), size: style.effects.slowmo.letterbox === true ? 0.11 : style.effects.slowmo.letterbox }))
    : [];

  // Eventos (tempos relativos ao início do segmento, na saída)
  const ev = [...letterboxEv];
  const fx = style.effects, tx = style.text;
  kills.forEach((k, j) => {
    const i = idxOf[j];
    const tk = +outTime(pieces, k.t).toFixed(3);
    if (wants('zoom', i, n, k)) ev.push({ type: 'zoom', t: tk, amount: fx.zoom.amount, duration: fx.zoom.duration });
    if (wants('shake', i, n, k)) ev.push({ type: 'shake', t: tk, px: fx.shake.px, duration: fx.shake.duration, rot: fx.shake.rot || 0 });
    if (wants('flash', i, n, k)) ev.push({ type: 'flash', t: tk, opacity: fx.flash.opacity, duration: fx.flash.duration });
    if (wants('rgbsplit', i, n, k)) ev.push({ type: 'rgbsplit', t: tk, px: fx.rgbsplit.px, duration: fx.rgbsplit.duration });
    if (fx.bloom && wants('bloom', i, n, k)) ev.push({ type: 'bloom', t: tk, amount: fx.bloom.amount, duration: fx.bloom.duration });
    const labelHere = tx.labels && c.label && i === n - 1; // o rótulo do clipe já ocupa o último kill
    if (tx.killCounter && n >= 2 && i >= 1 && !labelHere) {
      const text = i + 1 >= 5 ? 'ACE' : tx.counterFormat.replace('{n}', String(i + 1));
      ev.push({ type: 'text', t: tk, duration: tx.counterDuration, text, role: 'counter' });
    }
  });
  if (tx.labels && c.label && lastGroup) ev.push({ type: 'text', t: +(outTime(pieces, kn) + 0.05).toFixed(3), duration: tx.labelDuration, text: c.label, role: 'label' });
  for (const ct of (c.texts || []).filter((x) => x.t >= s && x.t <= e)) {
    const role = ct.role || 'caption';
    ev.push({ type: 'text', t: +outTime(pieces, ct.t).toFixed(3), duration: ct.duration || (role === 'caption' ? tx.captionDuration : 1), text: ct.text, role, ...(ct.color ? { color: ct.color } : {}) });
  }
  if (segments.length && style.transitions.flashOnCut) ev.push({ type: 'flash', t: 0, opacity: fx.flash.opacity, duration: fx.flash.duration });
  if (segments.length && style.transitions.blurIn) ev.push({ type: 'blurin', t: 0, duration: 0.12 });
  // Pulso no grave (effects.beatBump): zoom curtinho nos beats fortes, longe dos kills.
  const bb = fx.beatBump;
  if (bb && bb.on && beats) {
    const killTs = kills.map((k) => outTime(pieces, k.t));
    beats.forEach((b, bi) => {
      const t = b - T;
      if (t < 0.1 || t > D - 0.1 || (beatStrength[bi] ?? 0) < (bb.minStrength ?? 0.55)) return;
      if (killTs.some((kt) => Math.abs(kt - t) < 0.35)) return;
      ev.push({ type: 'zoom', t: +t.toFixed(3), amount: bb.amount ?? 0.035, duration: bb.duration ?? 0.18, bump: true });
    });
  }

  segments.push({
    index: segments.length, file, sourceDuration: +dur.toFixed(3), start: T === 0 ? 0 : +T.toFixed(3),
    pieces, outDuration: +D.toFixed(3), kills: kills.map((k) => ({ t: k.t, headshot: !!k.headshot, out: +outTime(pieces, k.t).toFixed(3) })),
    label: lastGroup ? c.label || '' : '', events: ev.sort((a, b) => a.t - b.t),
    // transitions.type pode ser uma lista: alterna entre elas a cada corte (ex.: ["zoomin","fadewhite","hblur"]).
    transition: segments.length ? { type: Array.isArray(style.transitions.type) ? style.transitions.type[(segments.length - 1) % style.transitions.type.length] : style.transitions.type, duration: style.transitions.duration } : null,
  });
  T += D;
  prevEnd = e;
  }
}
if (!segments.length) { console.error('ERRO: nenhum segmento montado. Confira kills.json.'); process.exit(1); }

// Transições com sobreposição (xfade): estende o segmento anterior para manter o corte no beat.
if (style.transitions.type !== 'cut' && style.transitions.duration > 0) {
  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1], d = style.transitions.duration;
    const last = prev.pieces[prev.pieces.length - 1];
    const room = prev.sourceDuration - last.b;
    const ext = Math.min(d * last.speed, room);
    last.b = +(last.b + ext).toFixed(3);
    prev.outDuration = +(prev.outDuration + ext / last.speed).toFixed(3);
    segments[i].transition.duration = +Math.min(d, ext / last.speed).toFixed(3);
  }
}

// Orçamento de flashes (effects.flash.maxPerMin): os edits mais vistos usam ~3–4/min; acima disso
// remove primeiro os flashes de corte e de kills comuns, mantendo os do rótulo e do último kill de cada clipe.
const fb = style.effects.flash?.maxPerMin;
if (fb) {
  const all = [];
  segments.forEach((sg, si) => sg.events.forEach((e) => { if (e.type === 'flash') all.push({ sg, e, prio: (sg.label ? 3 : 0) + (sg.kills.some((k) => Math.abs(k.out - e.t) < 0.02) && e.t === Math.max(...sg.kills.map((k) => k.out)) ? 2 : 0) + (e.t === 0 ? -1 : 0) + si / 1000 }); }));
  const allowed = Math.max(1, Math.round((fb * T) / 60));
  if (all.length > allowed) {
    const drop = new Set(all.sort((a, b) => a.prio - b.prio).slice(0, all.length - allowed).map((x) => x.e));
    segments.forEach((sg) => { sg.events = sg.events.filter((e) => !drop.has(e)); });
    console.log(`Flashes: ${all.length} → ${allowed} (orçamento de ${fb}/min)`);
  }
}

// Início de cada segmento no vídeo final (descontando a sobreposição das transições xfade).
const usesXfade = style.transitions.type !== 'cut' && style.transitions.duration > 0;
let acc = 0;
segments.forEach((sg, i) => {
  if (i) acc += segments[i - 1].outDuration - (usesXfade ? sg.transition?.duration || 0 : 0);
  sg.finalStart = +acc.toFixed(3);
});
const finalBody = segments.length ? segments.at(-1).finalStart + segments.at(-1).outDuration : 0;

// Palavras no beat (style.words): uma palavra grande por batida, como edits com letra/hype words.
const W8 = style.words;
if (W8 && Array.isArray(W8.list) && W8.list.length && beats) {
  const every = W8.every || 1;
  let bi = beats.findIndex((b) => b >= (W8.from || 0));
  for (const [wi, word] of W8.list.entries()) {
    const t0 = beats[bi + wi * every];
    if (t0 === undefined || t0 >= finalBody) break;
    const t1 = beats[bi + (wi + 1) * every] ?? t0 + 0.5;
    const sg = [...segments].reverse().find((s) => s.finalStart <= t0 + 1e-6);
    sg.events.push({ type: 'text', role: 'word', text: word, t: +(t0 - sg.finalStart).toFixed(3), duration: +Math.min(0.9, (t1 - t0) * 0.92).toFixed(3) });
    sg.events.sort((a, b) => a.t - b.t);
  }
}

// Cold open (style.coldOpen): o vídeo ABRE com um flash do kill-herói em câmera lenta (gancho dos
// primeiros 1–2 s, como recomendam os guias de retenção de Shorts/TikTok), antes do título e do 1º clipe.
let coldOpen = null;
const CO = style.coldOpen;
if (CO && segments.length) {
  const hs = segments.at(-1), hk = hs.kills.at(-1);
  const a = Math.max(0, hk.t - (CO.before ?? 0.45)), b = Math.min(hs.sourceDuration, hk.t + (CO.after ?? 0.4));
  const sp = CO.speed ?? 0.45;
  const Dco = (b - a) / sp, tk = (hk.t - a) / sp;
  coldOpen = {
    file: hs.file, pieces: [{ a: +a.toFixed(3), b: +b.toFixed(3), speed: sp }], outDuration: +Dco.toFixed(3),
    events: [
      { type: 'letterbox', t: 0, duration: +Dco.toFixed(3), size: 0.12 },
      { type: 'zoom', t: +tk.toFixed(3), amount: 0.1, duration: 0.4 },
      { type: 'flash', t: +tk.toFixed(3), opacity: 0.5, duration: 0.08 },
      ...(CO.text ? [{ type: 'text', role: 'label', text: CO.text, t: +(tk + 0.05).toFixed(3), duration: +Math.max(0.4, Dco - tk - 0.1).toFixed(3) }] : []),
    ],
  };
}

const killsHome = path.basename(killsDir).startsWith('_analise') ? path.dirname(killsDir) : killsDir;
const outDir = res(style.output.dir, styleDir) || path.join(killsHome, 'saida');
const plan = {
  version: 1,
  createdFrom: { style: stylePath, kills: killsPath },
  name: style.output.name || style.name || 'highlight',
  output: { ...style.output, dir: outDir },
  music: musicFile ? { file: musicFile, offset: +musicOffset.toFixed(3), volume: style.music.volume, fadeOut: style.music.fadeOut, bpm, duration: +musicDuration.toFixed(2) } : null,
  beats: beats ? beats.filter((b) => b <= T + 1) : null,
  audio: style.audio,
  color: { ...style.color, lut: res(style.color.lut, styleDir) },
  text: { ...style.text, font: res(style.text.font, styleDir) },
  slowmoInterpolate: style.effects.slowmo.interpolate,
  titleCard: style.titleCard?.text ? style.titleCard : null,
  coldOpen,
  outroCard: style.outroCard ? { ...style.outroCard, music: style.outroCard.music ?? (musicFile && fs.existsSync(musicFile.replace(/\.[^.]+$/, '.credito.txt')) ? fs.readFileSync(musicFile.replace(/\.[^.]+$/, '.credito.txt'), 'utf8').split(/\r?\n/)[0] : style.music._credito || null) } : null,
  watermark: style.watermark?.text ? style.watermark : null,
  sfx: style.sfx || null,
  words: W8 || null,
  hero: segments.length ? +(segments.at(-1).finalStart + (segments.at(-1).kills.at(-1)?.out ?? 0)).toFixed(3) : 0,
  firstKill: segments.length ? +(segments[0].kills[0]?.out ?? 0).toFixed(3) : 0,
  cuts: segments.slice(1).map((s) => s.finalStart),
  // Janelas de câmera lenta no tempo do corpo (para abafar a música: audio.muffleSlowmo).
  slowWindows: segments.flatMap((s) => { let o = 0; const w = []; for (const p of s.pieces) { const d = (p.b - p.a) / p.speed; if (p.speed < 0.75) w.push([+(s.finalStart + o).toFixed(3), +(s.finalStart + o + d).toFixed(3)]); o += d; } return w; }),
  motionBlur: style.motionBlur,
  transitions: style.transitions,
  intro: res(style.intro, styleDir),
  outro: res(style.outro, styleDir),
  logo: style.logo?.file ? { ...style.logo, file: res(style.logo.file, styleDir) } : null,
  totalDuration: +T.toFixed(3),
  segments,
};
const planPath = path.resolve(opt.out || path.join(killsDir, 'plan.json'));
L.writeJson(planPath, plan);

console.log(`\nPlano: ${planPath}`);
console.log(`${segments.length} segmentos, ${T.toFixed(1)}s de corpo${plan.music ? `, música a partir de ${plan.music.offset}s` : ', sem música'}`);
for (const sg of segments) {
  const slow = sg.pieces.some((p) => p.speed < 1) ? ' slow-mo' : '';
  console.log(`  #${sg.index} ${path.basename(sg.file)}  ${sg.pieces[0].a.toFixed(2)}–${sg.pieces[sg.pieces.length - 1].b.toFixed(2)}s → ${sg.outDuration.toFixed(2)}s  ${sg.kills.length} kill(s)${slow}${sg.label ? `  "${sg.label}"` : ''}`);
}
if (plan.music && musicDuration && musicDuration - plan.music.offset < T) console.warn('AVISO: a música é mais curta que o vídeo; o final ficará só com o áudio do jogo.');

// Comparação com o estudo de 121 edits de CS2 (terço mais visto dos de CS2 e dos curtos ≤60 s;
// references/channel-notes.md). São tendências, não regras: avisa quando o plano foge muito.
{
  const pre = (coldOpen?.outDuration || 0) + (plan.titleCard?.duration || 0);
  const total = finalBody + pre;
  const shots = segments.map((s) => s.outDuration);
  const cpm = ((segments.length - 1) / Math.max(1, finalBody)) * 60;
  const med = L.median(shots), longPct = Math.round((shots.filter((d) => d > 4).length / shots.length) * 100);
  const flashes = segments.reduce((n, s) => n + s.events.filter((e) => e.type === 'flash').length, 0) + (Array.isArray(style.transitions.type) ? style.transitions.type : [style.transitions.type]).filter((t) => t === 'fadewhite').length * Math.round((segments.length - 1) / (Array.isArray(style.transitions.type) ? style.transitions.type.length : 1));
  const fpm = (flashes / Math.max(1, total)) * 60;
  const firstAction = coldOpen ? 0.3 : pre + (segments[0]?.kills[0]?.out ?? 0);
  const rows = [
    ['cortes/min', cpm.toFixed(1), '12–17', cpm > 20 ? 'corta demais: aumente pacing.maxGap/preRoll ou use menos clipes' : cpm < 8 ? 'lento para um edit' : ''],
    ['plano mediano (s)', med.toFixed(2), '≥ 2,0', med < 1.7 ? 'jogadas picotadas: aumente pacing.maxGap (deixe a jogada respirar)' : ''],
    ['planos > 4 s', `${longPct}%`, '25–40%', longPct < 15 ? 'quase nenhum plano longo: os mais vistos deixam algumas jogadas inteiras' : ''],
    ['flashes/min', fpm.toFixed(1), '3–4', fpm > 7 ? 'flash demais: use effects.flash.maxPerMin' : fpm < 1 ? 'sem pontuação: um flash no kill decisivo ajuda' : ''],
    ['1ª ação (s)', firstAction.toFixed(1), '≤ 1,5', firstAction > 2 ? 'gancho tarde: use coldOpen ou encurte o título' : ''],
    ['duração (s)', total.toFixed(1), '30–60', ''],
  ];
  // Zona segura do Shorts/TikTok: botões e título cobrem ~400 px de baixo e a lateral direita.
  const hasLowText = segments.some((s) => s.events.some((e) => e.type === 'text' && (e.role === 'caption' || e.role === 'counter')));
  if ((style.output.formats || []).includes('9x16') && style.output.vertical !== 'blur' && hasLowText)
    rows.push(['vertical', style.output.vertical, 'blur', 'legendas/contador perto da borda de baixo caem atrás dos botões do Shorts/TikTok no corte 9:16: use output.vertical "blur" (jogo numa janela no centro)']);
  console.log('\nComparação com 121 edits de CS2 (tendência dos mais vistos):');
  for (const [k, v, ref, warn] of rows) console.log(`  ${k.padEnd(18)} ${String(v).padStart(7)}   ref ${ref.padEnd(8)} ${warn ? '⚠ ' + warn : '✓'}`);
}
