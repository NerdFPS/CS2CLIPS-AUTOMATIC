#!/usr/bin/env node
// Renderiza o plan.json: cada segmento com efeitos → junta (corte ou xfade) → mixa música →
// logo → versão vertical 9:16.
// Uso: node render.mjs plan.json [--preview] [--only 16x9|9x16] [--keep]
import path from 'node:path';
import fs from 'node:fs';
import * as L from './lib.mjs';

const { pos, opt } = L.parseArgs(process.argv.slice(2));
if (!pos[0]) { console.error('uso: node render.mjs plan.json [--preview] [--only 16x9|9x16] [--keep]'); process.exit(1); }
await L.checkTools();

const planPath = path.resolve(pos[0]);
const plan = L.readJson(planPath);
const preview = !!opt.preview;
const O = plan.output;
const W = preview ? 960 : O.width || 1920;
const H = preview ? 540 : O.height || 1080;
const FPS = preview ? 30 : O.fps || 60;
const k = H / 1080; // escala de pixels dos efeitos
const f3 = L.f3;

const outDir = path.resolve(O.dir || path.join(path.dirname(planPath), 'saida'));
const work = path.join(outDir, preview ? '_render_preview' : '_render');
fs.mkdirSync(work, { recursive: true });
const enc = await L.videoEncArgs({ preview, crf: O.crf ?? 18 });
const audioEnc = ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2'];
console.log(`Renderizando ${W}x${H} @ ${FPS}fps (${enc[1]})${preview ? ' [PRÉVIA]' : ''}`);

const hasFont = L.ensureFont(work, plan.text?.font);
if (!hasFont) console.warn('AVISO: nenhuma fonte encontrada; textos serão ignorados. Defina text.font no estilo.');
// Fonte limpa para legendas (estilo comentário): text.captionFont ou Segoe UI/Arial negrito.
const capSrc = [plan.text?.captionFont, 'C:/Windows/Fonts/seguisb.ttf', 'C:/Windows/Fonts/segoeuib.ttf', 'C:/Windows/Fonts/arialbd.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'].find((p) => p && fs.existsSync(p));
const hasCapFont = !!capSrc;
if (capSrc) fs.copyFileSync(capSrc, path.join(work, 'cap.ttf'));
if (plan.color?.lut) fs.copyFileSync(plan.color.lut, path.join(work, 'lut.cube'));

const atempo = (sp) => {
  const parts = [];
  let s = sp;
  while (s < 0.5) { parts.push('atempo=0.5'); s /= 0.5; }
  while (s > 2) { parts.push('atempo=2'); s /= 2; }
  parts.push(`atempo=${s.toFixed(5)}`);
  return parts.join(',');
};
const win = (a, b) => `between(t,${f3(a)},${f3(b)})`;

function colorChain(c) {
  if (!c) return [];
  const ch = [];
  const mb = Math.round(plan.motionBlur || 0);
  if (mb >= 2) ch.push(`tmix=frames=${mb}`);
  if (c.warmth) {
    const w = Math.max(-0.5, Math.min(0.5, c.warmth));
    ch.push(`colorbalance=rm=${(w * 0.5).toFixed(3)}:gm=${(w * 0.15).toFixed(3)}:bm=${(-w * 0.6).toFixed(3)}:rh=${(w * 0.3).toFixed(3)}:bh=${(-w * 0.4).toFixed(3)}`);
  }
  if (c.contrast !== 1 || c.saturation !== 1 || c.brightness !== 0 || c.gamma !== 1)
    ch.push(`eq=contrast=${c.contrast}:saturation=${c.saturation}:brightness=${c.brightness}:gamma=${c.gamma}`);
  if (c.tealOrange) {
    // Grade "cinema": sombras azul-petróleo, realces laranja.
    const t = Math.max(0, Math.min(0.5, c.tealOrange));
    ch.push(`colorbalance=rs=${(-t * 0.5).toFixed(3)}:gs=${(t * 0.1).toFixed(3)}:bs=${(t * 0.6).toFixed(3)}:rh=${(t * 0.45).toFixed(3)}:bh=${(-t * 0.5).toFixed(3)}`);
  }
  if (c.lut) ch.push('lut3d=file=lut.cube');
  if (c.vignette) ch.push('vignette=PI/5');
  if (c.sharpen > 0) ch.push(`unsharp=5:5:${c.sharpen}`);
  if (c.grain > 0) ch.push(`noise=alls=${Math.round(Math.min(1, c.grain) * 18)}:allf=t+u`); // grão de filme
  return ch;
}

function effectChain(seg, idx) {
  const ev = seg.events || [];
  const ch = [];
  // Zoom "punch" + tremida via zoompan (saída de tamanho fixo).
  const zooms = ev.filter((e) => e.type === 'zoom');
  const shakes = ev.filter((e) => e.type === 'shake');
  if (zooms.length || shakes.length) {
    const T = `(on/${FPS})`;
    const zt = zooms.map((e) => {
      const a = e.t - 0.04, d = e.duration;
      return `if(between(${T},${f3(a)},${f3(e.t)}),${e.amount}*(${T}-${f3(a)})/0.04,if(between(${T},${f3(e.t)},${f3(e.t + d)}),${e.amount}*pow(1-(${T}-${f3(e.t)})/${f3(d)},2),0))`;
    });
    const st = shakes.map((e) => `if(between(${T},${f3(e.t)},${f3(e.t + e.duration)}),${(e.px * k).toFixed(2)}*(1-(${T}-${f3(e.t)})/${f3(e.duration)}),0)`);
    const S = st.length ? `(${st.join('+')})` : '0';
    // Rotação curta na tremida (1–3°, mais realista): envelope em graus + zoom extra para esconder os cantos.
    const rt = shakes.filter((e) => e.rot > 0).map((e) => `if(between(${T},${f3(e.t)},${f3(e.t + e.duration)}),${e.rot}*(1-(${T}-${f3(e.t)})/${f3(e.duration)}),0)`);
    const R = rt.length ? `(${rt.join('+')})` : '0';
    const Z = `1+${zt.length ? zt.join('+') : '0'}+2.2*${S}/${H}+${(1.9 * Math.PI / 180).toFixed(5)}*${R}`;
    ch.push(`zoompan=z='${Z}':x='iw/2-(iw/zoom/2)+${S}*sin(${T}*71)':y='ih/2-(ih/zoom/2)+${S}*cos(${T}*53)':d=1:s=${W}x${H}:fps=${FPS}`);
    if (rt.length) {
      const Rt = R.replaceAll(T, 't');
      ch.push(`rotate=a='${Rt}*sin(t*29)*PI/180':c=black:ow=iw:oh=ih`);
    }
  }
  const rgb = ev.filter((e) => e.type === 'rgbsplit');
  if (rgb.length) {
    const px = Math.max(1, Math.round(rgb[0].px * k));
    ch.push('format=gbrp', `rgbashift=rh=-${px}:bh=${px}:enable='${rgb.map((e) => win(e.t, e.t + e.duration)).join('+')}'`, 'format=yuv420p');
  }
  for (const e of ev.filter((x) => x.type === 'blurin')) {
    // O plano entra borrado e foca (esconde o corte).
    const h = e.duration / 2;
    ch.push(`gblur=sigma=${(14 * k).toFixed(1)}:enable='${win(e.t, e.t + h)}'`, `gblur=sigma=${(6 * k).toFixed(1)}:enable='${win(e.t + h, e.t + e.duration)}'`);
  }
  const blooms = ev.filter((x) => x.type === 'bloom');
  if (blooms.length) {
    // Estouro de luz: clareia e desfoca de leve no impacto, voltando ao normal (overexposure de edit).
    const en = blooms.map((e) => win(e.t, e.t + e.duration)).join('+');
    const a = Math.max(0.05, Math.min(0.6, blooms[0].amount || 0.3));
    ch.push(`gblur=sigma=${(6 * k).toFixed(1)}:enable='${en}'`, `eq=brightness=${(a * 0.6).toFixed(2)}:contrast=${(1 - a * 0.5).toFixed(2)}:enable='${en}'`);
  }
  for (const e of ev.filter((x) => x.type === 'letterbox')) {
    // Barras de cinema durante o slow-motion (replay dramático).
    const bh = `ih*${e.size || 0.11}`, en = `enable='${win(e.t, e.t + e.duration)}'`;
    ch.push(`drawbox=x=0:y=0:w=iw:h=${bh}:color=black:t=fill:${en}`, `drawbox=x=0:y=ih-${bh}:w=iw:h=${bh}:color=black:t=fill:${en}`);
  }
  for (const e of ev.filter((x) => x.type === 'flash')) {
    const h = e.duration / 2;
    ch.push(`drawbox=x=0:y=0:w=iw:h=ih:color=white@${e.opacity}:t=fill:enable='${win(e.t, e.t + h)}'`);
    ch.push(`drawbox=x=0:y=0:w=iw:h=ih:color=white@${(e.opacity / 2).toFixed(2)}:t=fill:enable='${win(e.t + h, e.t + e.duration)}'`);
  }
  if (hasFont) {
    const tx = plan.text;
    ev.filter((x) => x.type === 'text').forEach((e, j) => {
      const tf = `txt_${idx}_${j}.txt`;
      fs.writeFileSync(path.join(work, tf), e.text);
      const counter = e.role === 'counter', caption = e.role === 'caption', word = e.role === 'word';
      if (word) {
        // Palavra no beat: grande, centralizada, translúcida, entra seca.
        const wd = plan.words || {};
        const size = Math.round(H * (wd.size || 0.2));
        ch.push(`drawtext=fontfile=font.ttf:textfile=${tf}:expansion=none:fontsize=${size}:fontcolor=${wd.color || 'white'}@${wd.opacity ?? 0.85}:borderw=0` +
          `:shadowcolor=black@0.35:shadowx=${Math.round(4 * k)}:shadowy=${Math.round(4 * k)}:x=(w-text_w)/2:y=(h-text_h)/2:enable='${win(e.t, e.t + e.duration)}'`);
        return;
      }
      const size = Math.round(H * (caption ? tx.captionSize : counter ? tx.counterSize : tx.size));
      const posName = caption ? tx.captionPosition : counter ? tx.counterPosition : tx.position;
      const y = { center: '(h-text_h)/2', bottom: 'h*0.80-text_h/2', top: 'h*0.12', upper: 'h*0.28', lower: 'h*0.62-text_h/2', caption: 'h*0.86-text_h/2' }[posName] || '(h-text_h)/2';
      const a = e.t, b = e.t + e.duration;
      // Legenda entra seca (como fala); títulos/contadores com fade curto.
      const alpha = caption ? '1' : `if(lt(t,${f3(a + 0.08)}),(t-${f3(a)})/0.08,if(gt(t,${f3(b - 0.15)}),(${f3(b)}-t)/0.15,1))`;
      const font = caption && hasCapFont ? 'cap.ttf' : 'font.ttf';
      const color = caption ? (e.color || tx.captionColor) : tx.color;
      const border = caption ? tx.captionBorder : tx.border, bw = caption ? tx.captionBorderW : tx.borderW;
      ch.push(`drawtext=fontfile=${font}:textfile=${tf}:expansion=none:fontsize=${size}:fontcolor=${color}:borderw=${Math.round(bw * k)}:bordercolor=${border}` +
        `:shadowcolor=black@0.5:shadowx=${Math.round(tx.shadow * k)}:shadowy=${Math.round(tx.shadow * k)}:x=(w-text_w)/2:y=${y}:alpha='${alpha}':enable='${win(a, b)}'`);
    });
  }
  return ch;
}

async function renderSegment(seg, idx, { raw = false, gain = 1 } = {}) {
  const info = await L.probe(seg.file);
  const fc = [];
  seg.pieces.forEach((p, i) => {
    const d = (p.b - p.a) / p.speed;
    let v = `[0:v]trim=start=${f3(p.a)}:end=${f3(p.b)},setpts=(PTS-STARTPTS)/${p.speed}`;
    if (p.speed < 1 && !preview && plan.slowmoInterpolate && plan.slowmoInterpolate !== 'none') {
      v += plan.slowmoInterpolate === 'mci' ? `,minterpolate=fps=${FPS}:mi_mode=mci:mc_mode=aobmc:vsbmc=1` : `,minterpolate=fps=${FPS}:mi_mode=blend`;
    }
    fc.push(`${v},fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,format=yuv420p[v${i}]`);
    let a;
    if (info.hasAudio) {
      a = `[0:a]atrim=start=${f3(p.a)}:end=${f3(p.b)},asetpts=PTS-STARTPTS`;
      if (p.speed !== 1) a += `,${atempo(p.speed)}${plan.audio?.slowmoGameAudio === 'mute' ? ',volume=0' : ''}`;
    } else a = `anullsrc=r=48000:cl=stereo,atrim=duration=${f3(d)}`;
    fc.push(`${a},aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
  });
  fc.push(`${seg.pieces.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${seg.pieces.length}:v=1:a=1[vc][ac]`);
  const chain = raw ? [] : [...colorChain(plan.color), ...effectChain(seg, idx)];
  fc.push(`[vc]${[...chain, 'format=yuv420p'].join(',')}[vout]`);
  fc.push(`[ac]volume=${gain}[aout]`);
  const out = path.join(work, `seg_${String(idx).padStart(3, '0')}.mp4`);
  const total = seg.pieces.reduce((s, p) => s + (p.b - p.a) / p.speed, 0);
  await L.ffmpeg(['-y', '-i', seg.file, '-filter_complex', fc.join(';'), '-map', '[vout]', '-map', '[aout]', ...enc, '-r', String(FPS), ...audioEnc, '-t', f3(total), out], { cwd: work });
  return out;
}

async function concatCopy(files, out) {
  const list = path.join(work, `list_${path.basename(out)}.txt`);
  fs.writeFileSync(list, files.map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
  await L.ffmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out]);
}

async function xfadeJoin(files, transitions, out) {
  const durs = [];
  for (const f of files) durs.push((await L.probe(f)).duration);
  const fc = [];
  let vPrev = '[0:v]', aPrev = '[0:a]', acc = durs[0];
  for (let i = 1; i < files.length; i++) {
    const tr = transitions[i] || { type: 'fade', duration: 0.2 };
    const d = Math.max(0.04, Math.min(tr.duration || 0.2, durs[i - 1] - 0.05, durs[i] - 0.05));
    const off = acc - d;
    const type = tr.type === 'cut' ? 'fade' : tr.type;
    fc.push(`${vPrev}[${i}:v]xfade=transition=${type}:duration=${f3(d)}:offset=${f3(off)}[xv${i}]`);
    fc.push(`${aPrev}[${i}:a]acrossfade=d=${f3(d)}[xa${i}]`);
    vPrev = `[xv${i}]`; aPrev = `[xa${i}]`;
    acc = off + durs[i];
  }
  await L.ffmpeg(['-y', ...files.flatMap((f) => ['-i', f]), '-filter_complex', fc.join(';'), '-map', vPrev, '-map', aPrev, ...enc, ...audioEnc, out]);
}

// 1) Segmentos
const segFiles = [];
for (const seg of plan.segments) {
  console.log(`Segmento ${seg.index + 1}/${plan.segments.length}: ${path.basename(seg.file)}`);
  segFiles.push(await renderSegment(seg, seg.index, { gain: plan.audio?.gameVolume ?? 0.55 }));
}

// 2) Corpo
const body = path.join(work, 'body.mp4');
const useXfade = plan.transitions?.type && plan.transitions.type !== 'cut' && segFiles.length > 1;
if (useXfade) await xfadeJoin(segFiles, plan.segments.map((s) => s.transition), body);
else if (segFiles.length > 1) await concatCopy(segFiles, body);
else fs.copyFileSync(segFiles[0], body);
const bodyDur = (await L.probe(body)).duration;

// 3) Intro/outro (normalizados) + corpo
const parts = [];
let introDur = 0;
for (const [kind, file] of [['intro', plan.intro], ['outro', plan.outro]]) {
  if (!file) continue;
  const d = (await L.probe(file)).duration;
  const p = await renderSegment({ file, pieces: [{ a: 0, b: d, speed: 1 }], events: [] }, kind === 'intro' ? 900 : 901, { raw: true, gain: 1 });
  if (kind === 'intro') { parts.unshift(p); introDur = (await L.probe(p)).duration; } else parts.push(p);
}
parts.splice(plan.intro ? 1 : 0, 0, body);

// Cartão de título (plan.titleCard): nome grande sobre preto, crescendo, com glitch na entrada.
// A música já toca embaixo dele (o riser termina no 1º kill).
let titleDur = 0;
if (plan.titleCard && hasFont && !plan.intro) {
  const tc = plan.titleCard;
  titleDur = tc.duration || 1.6;
  fs.writeFileSync(path.join(work, 'title.txt'), tc.text);
  if (tc.sub) fs.writeFileSync(path.join(work, 'title_sub.txt'), tc.sub);
  const size = Math.round(H * (tc.size || 0.2));
  const D = titleDur;
  const vf = [
    `drawtext=fontfile=font.ttf:textfile=title.txt:expansion=none:fontsize=${size}:fontcolor=${tc.color || '#E8E8E8'}:x=(w-text_w)/2:y=(h-text_h)/2:alpha='min(1,t/0.25)'`,
    `zoompan=z='1+0.16*on/${Math.round(D * FPS)}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS}`,
    'format=gbrp', `rgbashift=rh=-${Math.round(10 * k)}:bh=${Math.round(10 * k)}:enable='lt(t,0.18)+between(t,${f3(D * 0.55)},${f3(D * 0.62)})'`, 'format=yuv420p',
    ...(tc.sub ? [`drawtext=fontfile=${hasCapFont ? 'cap.ttf' : 'font.ttf'}:textfile=title_sub.txt:expansion=none:fontsize=${Math.round(H * 0.04)}:fontcolor=white@0.8:x=(w-text_w)/2:y=h*0.68:alpha='min(1,max(0,(t-0.35)/0.3))'`] : []),
    `fade=t=out:st=${f3(D - 0.18)}:d=0.18`, 'format=yuv420p',
  ];
  const card = path.join(work, 'titlecard.mp4');
  await L.ffmpeg(['-y', '-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:r=${FPS}:d=${f3(D)}`, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
    '-vf', vf.join(','), '-map', '0:v', '-map', '1:a', ...enc, '-r', String(FPS), ...audioEnc, '-t', f3(D), card], { cwd: work });
  parts.unshift(card);
}
// Cold open: flash do kill-herói antes de tudo (gancho).
let coldDur = 0;
if (plan.coldOpen && !plan.intro) {
  const co = await renderSegment(plan.coldOpen, 950, { gain: plan.audio?.gameVolume ?? 0.55 });
  coldDur = (await L.probe(co)).duration;
  parts.unshift(co);
}
const preDur = titleDur + coldDur; // tudo que vem antes do corpo (a música já toca aí)
// Cartão de créditos no fim (plan.outroCard): "EDIT BY / MUSIC (crédito NCS) / @handle" sobre preto.
let postDur = 0;
if (plan.outroCard && hasFont && !plan.outro) {
  const oc = plan.outroCard;
  postDur = oc.duration || 2.5;
  const lines = [[oc.made ? `EDIT BY ${oc.made}` : null, 0.055, 'font.ttf', 0.40], [oc.music ? `MUSIC  ${oc.music}` : null, 0.032, hasCapFont ? 'cap.ttf' : 'font.ttf', 0.52], [oc.handle || null, 0.036, hasCapFont ? 'cap.ttf' : 'font.ttf', 0.62]].filter((l) => l[0]);
  const vf = lines.map(([txt, sz, font, yy], i) => {
    fs.writeFileSync(path.join(work, `outro_${i}.txt`), txt);
    return `drawtext=fontfile=${font}:textfile=outro_${i}.txt:expansion=none:fontsize=${Math.round(H * sz)}:fontcolor=white:x=(w-text_w)/2:y=h*${yy}-text_h/2:alpha='min(1,max(0,(t-${(0.15 + i * 0.15).toFixed(2)})/0.3))'`;
  });
  vf.push(`fade=t=out:st=${f3(postDur - 0.4)}:d=0.4`, 'format=yuv420p');
  const card = path.join(work, 'outrocard.mp4');
  await L.ffmpeg(['-y', '-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:r=${FPS}:d=${f3(postDur)}`, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
    '-vf', vf.join(','), '-map', '0:v', '-map', '1:a', ...enc, '-r', String(FPS), ...audioEnc, '-t', f3(postDur), card], { cwd: work });
  parts.push(card);
}
const full = path.join(work, 'full.mp4');
if (parts.length > 1) await concatCopy(parts, full); else fs.copyFileSync(body, full);

// 4) Música + logo + loudness → 16:9 final
const name = plan.name + (preview ? '_previa' : '');
fs.mkdirSync(outDir, { recursive: true });
const master = path.join(outDir, `${name}_16x9.mp4`);
{
  const inputs = ['-i', full];
  const fc = [];
  let aOut = '[0:a]';
  const lead = preDur || introDur; // onde o corpo começa no vídeo final
  const heroT = (plan.hero || 0) + lead;
  if (plan.music) {
    inputs.push('-i', plan.music.file);
    // Com cartão de título a música começa antes (toca embaixo do título); com intro em vídeo, espera a intro.
    const start = Math.max(0, plan.music.offset - preDur);
    const len = bodyDur + preDur + postDur; // a música segue (e some) sob o cartão de créditos
    const fo = Math.min(plan.music.fadeOut || 0, len);
    const delay = preDur ? 0 : Math.round(introDur * 1000);
    let duck = plan.sfx?.duckHero ? `,volume=enable='between(t,${f3(heroT - 0.05)},${f3(heroT + 0.7)})':volume=${plan.sfx.duckHero}` : '';
    // Música "debaixo d'água" no slow-mo (passa-baixa): o momento lento se destaca e o tiro do jogo aparece.
    const mf = plan.audio?.muffleSlowmo;
    if (mf && plan.slowWindows?.length) duck += `,lowpass=f=${mf === true ? 900 : mf}:enable='${plan.slowWindows.map(([a, b]) => `between(t,${f3(a + preDur)},${f3(b + preDur)})`).join('+')}'`;
    fc.push(`[1:a]atrim=start=${f3(start)},asetpts=PTS-STARTPTS,volume=${plan.music.volume ?? 1}${duck}` +
      `${fo > 0 ? `,afade=t=out:st=${f3(len - fo)}:d=${f3(fo)}` : ''},atrim=end=${f3(len)}` +
      `${delay ? `,adelay=${delay}|${delay}` : ''},aresample=48000,aformat=channel_layouts=stereo,apad[mus]`);
    fc.push(`[0:a][mus]amix=inputs=2:duration=first:normalize=0[mix]`);
    aOut = '[mix]';
  }
  // Efeitos sonoros sintetizados (sem samples, sem direitos): whoosh nos cortes, impact no kill-herói,
  // riser terminando no 1º kill (o drop).
  if (plan.sfx) {
    const sx = plan.sfx, gen = [];
    const mk = async (name, src, af) => { const f = path.join(work, `${name}.wav`); await L.ffmpeg(['-y', '-f', 'lavfi', '-i', src, '-af', `${af},pan=stereo|c0=c0|c1=c0,aresample=48000`, f]); return f; };
    const cutTimes = (plan.cuts || []).map((c) => c + lead - 0.12).filter((t) => t > 0);
    if (sx.whoosh && cutTimes.length) gen.push({ f: await mk('whoosh', 'anoisesrc=d=0.45:c=pink:r=48000:a=0.9', 'bandpass=f=1700:width_type=o:w=2.5,afade=t=in:d=0.3:curve=exp,afade=t=out:st=0.3:d=0.15'), times: cutTimes, gain: sx.whoosh });
    if (sx.impact) gen.push({ f: await mk('impact', "aevalsrc='0.9*sin(2*PI*(55-25*t)*t)*exp(-4.5*t)+0.35*(2*random(0)-1)*exp(-30*t)':s=48000:d=1.4", 'lowpass=f=4000'), times: [heroT], gain: sx.impact });
    const firstT = (plan.firstKill || 0) + lead;
    const rd = Math.min(sx.riserDuration || 1.8, firstT);
    if (sx.riser && rd > 0.4) gen.push({ f: await mk('riser', `anoisesrc=d=${f3(rd)}:c=white:r=48000:a=0.6`, `highpass=f=500,lowpass=f=7000,afade=t=in:d=${f3(rd)}:curve=exp`), times: [firstT - rd], gain: sx.riser });
    if (gen.length) {
      const labels = [];
      gen.forEach((g, gi) => {
        const ii = inputs.filter((x) => x === '-i').length;
        inputs.push('-i', g.f);
        const n = g.times.length;
        fc.push(`[${ii}:a]${n > 1 ? `asplit=${n}${g.times.map((_, j) => `[s${gi}_${j}]`).join('')}` : `anull[s${gi}_0]`}`);
        g.times.forEach((t, j) => { const ms = Math.max(0, Math.round(t * 1000)); fc.push(`[s${gi}_${j}]adelay=${ms}|${ms},volume=${g.gain}[d${gi}_${j}]`); labels.push(`[d${gi}_${j}]`); });
      });
      fc.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0,apad[sfx]`);
      fc.push(`${aOut}[sfx]amix=inputs=2:duration=first:normalize=0[mixs]`);
      aOut = '[mixs]';
    }
  }
  if (plan.audio?.loudnorm !== false) {
    // Duas passadas: mede e depois aplica ganho linear exato (-14 LUFS, padrão de YouTube/TikTok).
    const target = 'I=-14:TP=-1.5:LRA=11';
    const measureFc = [...fc, `${aOut}loudnorm=${target}:print_format=json[meas]`];
    const r = await L.ffmpeg([...inputs, '-filter_complex', measureFc.join(';'), '-map', '[meas]', '-f', 'null', '-'], { keepStderr: true, allowFail: true });
    const js = r.stderr.slice(r.stderr.lastIndexOf('{'), r.stderr.lastIndexOf('}') + 1);
    let m = null;
    try { m = JSON.parse(js); } catch { /* cai no modo de uma passada */ }
    const second = m && Number.isFinite(+m.input_i)
      ? `loudnorm=${target}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`
      : `loudnorm=${target}`;
    fc.push(`${aOut}${second}[aout]`);
    aOut = '[aout]';
  }
  let vOut = '0:v', vArgs = ['-c:v', 'copy'];
  if (plan.logo?.file) {
    const li = inputs.filter((x) => x === '-i').length;
    inputs.push('-loop', '1', '-i', plan.logo.file);
    const m = Math.round(W * 0.03);
    const xy = { tr: [`W-w-${m}`, `${m}`], tl: [`${m}`, `${m}`], br: [`W-w-${m}`, `H-h-${m}`], bl: [`${m}`, `H-h-${m}`] }[plan.logo.position || 'tl'];
    fc.push(`[${li}:v]scale=${Math.round(W * (plan.logo.scale || 0.12))}:-1,format=rgba,colorchannelmixer=aa=${plan.logo.opacity ?? 0.85}[lg]`);
    fc.push(`[0:v][lg]overlay=${xy[0]}:${xy[1]}:shortest=1,format=yuv420p[vout]`);
    vOut = '[vout]'; vArgs = enc;
  }
  if (plan.watermark && hasFont) {
    // Marca d'água de texto (@nick) no canto, só durante o corpo do vídeo.
    const wm = plan.watermark;
    fs.writeFileSync(path.join(work, 'wm.txt'), wm.text);
    const mg = Math.round(H * 0.035);
    const [x, y] = { br: [`w-text_w-${mg}`, `h-text_h-${mg}`], bl: [`${mg}`, `h-text_h-${mg}`], tr: [`w-text_w-${mg}`, `${mg}`], tl: [`${mg}`, `${mg}`] }[wm.position || 'br'];
    fc.push(`${vOut.startsWith('[') ? vOut : `[${vOut}]`}drawtext=fontfile=${hasCapFont ? 'cap.ttf' : 'font.ttf'}:textfile=wm.txt:expansion=none:fontsize=${Math.round(H * (wm.size || 0.03))}:fontcolor=white@${wm.opacity ?? 0.55}:x=${x}:y=${y}:enable='between(t,${f3(preDur)},${f3(preDur + bodyDur)})'[vwm]`);
    vOut = '[vwm]'; vArgs = enc;
  }
  const fullDur = (await L.probe(full)).duration;
  const fi = Math.min(O.fadeIn || 0, fullDur / 3), fo = Math.min(O.fadeOut || 0, fullDur / 3);
  if (fi > 0 || fo > 0) {
    const vf = [fi > 0 && `fade=t=in:st=0:d=${f3(fi)}`, fo > 0 && `fade=t=out:st=${f3(fullDur - fo)}:d=${f3(fo)}`].filter(Boolean);
    const af = [fi > 0 && `afade=t=in:st=0:d=${f3(fi)}`, fo > 0 && `afade=t=out:st=${f3(fullDur - fo)}:d=${f3(fo)}`].filter(Boolean);
    fc.push(`${vOut.startsWith('[') ? vOut : `[${vOut}]`}${vf.join(',')},format=yuv420p[vfade]`);
    fc.push(`${aOut.startsWith('[') ? aOut : `[${aOut}]`}${af.join(',')}[afade]`);
    vOut = '[vfade]'; aOut = '[afade]'; vArgs = enc;
  }
  const map = ['-map', vOut, '-map', aOut === '[0:a]' ? '0:a' : aOut];
  await L.ffmpeg(['-y', ...inputs, ...(fc.length ? ['-filter_complex', fc.join(';')] : []), ...map, ...vArgs, ...audioEnc, '-movflags', '+faststart', '-t', f3((await L.probe(full)).duration), master], { cwd: work });
  console.log(`✔ ${master}`);
}

// 4b) Versão para upload no YouTube em 1440p (output.youtube1440 ou --yt1440): mesmo ampliado de 1080p,
// o YouTube passa a usar VP9/bitrate maior e o vídeo fica bem menos borrado depois do processamento.
if ((O.youtube1440 || opt.yt1440) && !preview) {
  const yt = path.join(outDir, `${name}_youtube1440.mp4`);
  const ve = (await L.canUseNvenc()) ? ['-c:v', 'h264_nvenc', '-preset', 'p6', '-rc', 'vbr', '-b:v', '30M', '-maxrate', '40M', '-bufsize', '60M'] : ['-c:v', 'libx264', '-preset', 'slow', '-crf', '17'];
  await L.ffmpeg(['-y', '-i', master, '-vf', 'scale=2560:1440:flags=lanczos', ...ve, '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', yt]);
  console.log(`✔ ${yt}  (para subir no YouTube)`);
}

// 5) Vertical 9:16
const formats = opt.only ? [opt.only] : O.formats || ['16x9'];
if (formats.includes('9x16')) {
  const VW = preview ? 540 : 1080, VH = preview ? 960 : 1920;
  const kfr = O.killfeed || { x: 0.62, y: 0.04, w: 0.38, h: 0.24 };
  const mode = O.vertical || 'crop+killfeed';
  const center = `crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=${VW}:${VH},setsar=1`;
  let fc;
  if (mode === 'blur') fc = `[0:v]split[a][b];[a]scale=${VW}:${VH}:force_original_aspect_ratio=increase,crop=${VW}:${VH},boxblur=20:2[bg];[b]scale=${VW}:-2[fg];[bg][fg]overlay=0:(H-h)/2,setsar=1,format=yuv420p[v]`;
  else if (mode === 'crop') fc = `[0:v]${center},format=yuv420p[v]`;
  else fc = `[0:v]split[a][b];[a]${center}[bg];[b]crop=iw*${kfr.w}:ih*${kfr.h}:iw*${kfr.x}:ih*${kfr.y},scale=${Math.round(VW * 0.92)}:-2[kf];[bg][kf]overlay=(W-w)/2:${Math.round(VH * 0.06)},format=yuv420p[v]`;
  const vert = path.join(outDir, `${name}_9x16.mp4`);
  await L.ffmpeg(['-y', '-i', master, '-filter_complex', fc, '-map', '[v]', '-map', '0:a', ...enc, '-c:a', 'copy', '-movflags', '+faststart', vert]);
  console.log(`✔ ${vert}`);
}

if (!opt.keep && !preview) fs.rmSync(work, { recursive: true, force: true });
console.log(`\nDuração final: ${(await L.probe(master)).duration.toFixed(1)}s. Pasta: ${outDir}`);
