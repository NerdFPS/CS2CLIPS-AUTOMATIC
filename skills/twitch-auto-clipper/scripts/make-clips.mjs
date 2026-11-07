#!/usr/bin/env node
// Gera os clipes dos melhores candidatos: corta da FONTE em alta (só o trecho), legenda a fala, escreve o título,
// monta o vertical 9:16 (facecam em cima + jogo embaixo, ou jogo inteiro sobre fundo desfocado sem facecam)
// e o 16:9, faz capa (make-cover) e cópia leve (export-small) com os scripts da cs2-highlight-editor.
//   node make-clips.mjs <pasta-da-vod|id> [--top 6 | --ranks 1,3,5] [--edit zuhn|frogling-velocity] [--music ncs.mp3]
//                       [--only 9x16|16x9] [--preview] [--force] [--plan-only]
// Lê candidates.json (edite title/start/end antes, se quiser). --plan-only só grava as legendas (captions) de cada
// candidato escolhido no candidates.json, para revisar erros do Whisper antes de renderizar; o render usa c.captions.
// Saída: clips/NN_slug/*.mp4|jpg + clips.json
import fs from 'node:fs';
import path from 'node:path';
import { L, CS2_SCRIPTS, DEFAULT_STYLE, loadConfig, parseArgs, ytdlp, hms, slug } from './lib.mjs';

const { pos, opt } = parseArgs(process.argv.slice(2));
if (!pos[0]) { console.error('uso: node make-clips.mjs <pasta-da-vod|id> [--top 6|--ranks 1,3] [--edit zuhn] [--music f.mp3] [--only 9x16|16x9] [--preview]'); process.exit(1); }
await L.checkTools();
const cfg = loadConfig();
const dir = fs.existsSync(pos[0]) ? path.resolve(pos[0]) : path.join(cfg.dataDir, String(pos[0]));
const src = L.readJson(path.join(dir, 'source.json'));
const C = L.readJson(path.join(dir, 'candidates.json'));
const tr = fs.existsSync(path.join(dir, 'transcript.json')) ? L.readJson(path.join(dir, 'transcript.json')) : null;
const ranks = opt.ranks ? String(opt.ranks).split(',').map(Number) : null;
const sel = C.candidates.filter((c) => (ranks ? ranks.includes(c.rank) : c.rank <= Number(opt.top || cfg.topN)));
const outRoot = path.join(dir, 'clips');
fs.mkdirSync(outRoot, { recursive: true });
const enc = await L.videoEncArgs({ preview: !!opt.preview });
const formats = opt.only ? [opt.only] : ['9x16', '16x9'];
const editPreset = opt.edit || cfg.edit;
const manifest = [];

// ---- Legendas: palavras do Whisper → blocos de 1 a 4 palavras ----
function captionChunks(s, e) {
  if (!tr) return [];
  // O Whisper às vezes estica a 1ª palavra da frase por cima do silêncio (ex.: 10 s): limita a duração da palavra a 1 s.
  // seg = índice da frase, para nunca juntar o fim de uma frase com o começo da outra num bloco.
  const words = tr.segments.flatMap((g, gi) => (g.words || []).map((w) => ({ ...w, s: Math.max(w.s, w.e - 1), w: w.w.trim(), seg: gi })))
    .filter((w) => w.s >= s && w.e <= e + 0.3 && w.w);
  const out = [];
  let cur = [];
  const flush = () => { if (cur.length) out.push({ a: cur[0].s - s, b: cur.at(-1).e - s, text: cur.map((w) => w.w).join(' ').replace(/\s+([,.!?])/g, '$1') }); cur = []; };
  for (const w of words) {
    const gap = cur.length ? w.s - cur.at(-1).e : 0;
    if (cur.length && (cur.length >= 4 || gap > 0.45 || w.seg !== cur.at(-1).seg || (cur.map((x) => x.w).join(' ') + ' ' + w.w).length > 22 || (/[.!?]$/.test(cur.at(-1).w) || (cur.length >= 2 && /,$/.test(cur.at(-1).w))))) flush();
    cur.push(w);
  }
  flush();
  for (let i = 0; i < out.length; i++) out[i].b = Math.max(out[i].a + 0.35, Math.min(out[i].b + 0.25, out[i + 1] ? out[i + 1].a : out[i].b + 0.6));
  return out;
}
const esc = (n) => n.toFixed(3);
// A fonte do vídeo (Impact/Arial) não tem emoji: tira do texto queimado; o emoji fica no título sugerido p/ o post.
const noEmoji = (t) => (t || '').replace(/[\u{1F000}-\u{1FAFF}☀-➿️‍]/gu, '').replace(/\s{2,}/g, ' ').trim();

if (opt['plan-only']) {
  for (const c of sel) if (!c.captions) c.captions = captionChunks(c.start, c.end).map((k) => ({ a: +k.a.toFixed(2), b: +k.b.toFixed(2), text: k.text }));
  L.writeJson(path.join(dir, 'candidates.json'), C);
  console.log(`Legendas de ${sel.length} candidatos gravadas em candidates.json (campo captions, tempo relativo ao início do clipe). Revise e rode sem --plan-only.`);
  process.exit(0);
}

// ---- Trecho da fonte em alta ----
async function sourceSegment(c, work) {
  const pad = 2;
  const s = Math.max(0, c.start - pad), e = c.end + pad;
  if (src.kind === 'local') return { file: src.file, offset: c.start };
  const seg = path.join(work, 'fonte.mp4');
  if (!fs.existsSync(seg) || opt.force) {
    await ytdlp(['-S', `res:${cfg.clipHeight},fps`, '-f', 'b', '--download-sections', `*${s.toFixed(2)}-${e.toFixed(2)}`, '--force-keyframes-at-cuts', '-N', '8', '--no-part', '-o', seg, src.url]);
  }
  return { file: seg, offset: c.start - s };
}

for (const c of sel) {
  const name = `${String(c.rank).padStart(2, '0')}_${slug(c.title, 32)}`;
  const work = path.join(outRoot, name);
  fs.mkdirSync(work, { recursive: true });
  console.log(`\n#${c.rank} nota ${c.score} · ${hms(c.start)}–${hms(c.end)} · "${c.title}"`);
  const seg = await sourceSegment(c, work);
  const info = await L.probe(seg.file);
  const dur = +(c.end - c.start).toFixed(2);
  L.ensureFont(work, null);
  fs.writeFileSync(path.join(work, 'titulo.txt'), noEmoji(c.title));
  const caps = (c.captions || captionChunks(c.start, c.end)).filter((k) => noEmoji(k.text));
  caps.forEach((k, i) => fs.writeFileSync(path.join(work, `cap_${i}.txt`), noEmoji(k.text)));
  const capFilters = (W, H, size, y) => caps.map((k, i) =>
    `drawtext=fontfile=font.ttf:textfile=cap_${i}.txt:expansion=none:fontsize=${size}:fontcolor=white:borderw=${Math.round(size / 11)}:bordercolor=black` +
    `:x=(w-text_w)/2:y=${y}:enable='between(t,${esc(k.a)},${esc(k.b)})'`).join(',');
  const titleFilter = (size, y, until) => (noEmoji(c.title) ? `drawtext=fontfile=font.ttf:textfile=titulo.txt:expansion=none:fontsize=${size}:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=${Math.round(size * 0.35)}` +
    `:x=(w-text_w)/2:y=${y}${until ? `:enable='lt(t,${until})'` : ''}` : 'null');
  const audio = ['-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-c:a', 'aac', '-b:a', '192k'];
  const input = ['-ss', esc(seg.offset), '-t', esc(dur), '-i', seg.file];
  const outs = {};

  if (formats.includes('16x9')) {
    const f = `${name}_16x9.mp4`;
    const vf = [`scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=60`, titleFilter(58, 'h*0.05', 3.5), caps.length ? capFilters(1920, 1080, 64, 'h*0.80') : 'null'].join(',');
    await L.ffmpeg(['-y', ...input, '-vf', vf, ...enc, ...audio, f], { cwd: work });
    outs['16x9'] = path.join(work, f);
  }
  if (formats.includes('9x16')) {
    const f = `${name}_9x16.mp4`;
    let fc;
    const fcm = cfg.facecam;
    if (fcm) {
      // facecam em cima (38% da altura), jogo embaixo (corte central, onde fica a mira)
      const topH = 730, botH = 1190;
      const cropW = Math.round((info.height * 1080) / botH / 2) * 2;
      const kfz = c.kills >= 2 ? (cfg.killfeed || DEFAULT_STYLE.output.killfeed) : null;
      fc = [`[0:v]split=${kfz ? 3 : 2}[c][g]${kfz ? '[k]' : ''}`,
        `[c]crop=iw*${fcm.w}:ih*${fcm.h}:iw*${fcm.x}:ih*${fcm.y},scale=1080:${topH}:force_original_aspect_ratio=increase,crop=1080:${topH},setsar=1[top]`,
        `[g]crop=${cropW}:ih:(iw-${cropW})/2:0,scale=1080:${botH},setsar=1[bot]`,
        `[top][bot]vstack=inputs=2[st]`];
      let last = 'st';
      if (kfz) { fc.push(`[k]crop=iw*${kfz.w}:ih*${kfz.h}:iw*${kfz.x}:ih*${kfz.y},scale=560:-2[kf]`, `[st][kf]overlay=W-w-24:${topH + 24}[st2]`); last = 'st2'; }
      fc.push(`[${last}]fps=60,${titleFilter(60, `${topH}-text_h/2`, null)},${caps.length ? capFilters(1080, 1920, 76, `${topH + 200}`) : 'null'}[v]`);
    } else if ((cfg.verticalSemCam || 'zoom') === 'zoom') {
      // sem facecam, "zoom" (padrão): corte central 4:5 do jogo (onde fica a mira) ocupando 1080×1350 da tela,
      // fundo desfocado só nas faixas de cima (título) e de baixo; killfeed por cima nas jogadas com 2+ kills.
      const mainH = 1350, y0 = Math.round((1920 - mainH) / 2);
      const cropW = Math.round((info.height * 1080) / mainH / 2) * 2;
      const kfz = c.kills >= 2 ? (cfg.killfeed || DEFAULT_STYLE.output.killfeed) : null;
      fc = [`[0:v]split=${kfz ? 3 : 2}[b][g]${kfz ? '[k]' : ''}`,
        '[b]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:2,eq=brightness=-0.12[bg]',
        `[g]crop=${cropW}:ih:(iw-${cropW})/2:0,scale=1080:${mainH},setsar=1[fg]`, `[bg][fg]overlay=0:${y0}[st]`];
      let last = 'st';
      if (kfz) { fc.push(`[k]crop=iw*${kfz.w}:ih*${kfz.h}:iw*${kfz.x}:ih*${kfz.y},scale=520:-2[kf]`, `[st][kf]overlay=W-w-16:${y0 + 16}[st2]`); last = 'st2'; }
      fc.push(`[${last}]fps=60,setsar=1,${titleFilter(60, `${Math.round(y0 / 2)}-text_h/2`, null)},${caps.length ? capFilters(1080, 1920, 76, `${y0 + mainH - 330}`) : 'null'}[v]`);
    } else {
      // sem facecam, "inteiro": jogo inteiro numa faixa central sobre fundo desfocado (não corta o HUD)
      fc = ['[0:v]split=2[b][f]', '[b]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:2,eq=brightness=-0.08[bg]',
        '[f]scale=1080:-2[fg]', '[bg][fg]overlay=0:(H-h)/2[st]',
        `[st]fps=60,setsar=1,${titleFilter(64, 'h*0.22', null)},${caps.length ? capFilters(1080, 1920, 74, 'h*0.70') : 'null'}[v]`];
    }
    await L.ffmpeg(['-y', ...input, '-filter_complex', fc.join(';'), '-map', '[v]', '-map', '0:a:0', ...enc, ...audio, f], { cwd: work });
    outs['9x16'] = path.join(work, f);
  }
  // capa + cópia leve (cs2-highlight-editor)
  const apexT = Math.max(0.2, Math.min(dur - 0.2, c.apex - c.start));
  const short = (c.title || '').replace(/\s*[\u{1F300}-\u{1FAFF}☀-➿]\s*/gu, ' ').trim().slice(0, 28) || 'CLIPE';
  for (const [k, v] of Object.entries(outs)) {
    await L.run(process.execPath, [path.join(CS2_SCRIPTS, 'make-cover.mjs'), v, '--t', String(apexT), '--title', short.toUpperCase(), ...(k === '9x16' ? ['--vertical'] : [])]);
  }
  if (outs['9x16']) await L.run(process.execPath, [path.join(CS2_SCRIPTS, 'export-small.mjs'), outs['9x16'], '--mb', '28']);

  // versão "edit" das jogadas com um preset da cs2-highlight-editor
  let edit = null;
  if (editPreset && c.kills >= 2) {
    const ed = path.join(work, 'edit');
    fs.mkdirSync(ed, { recursive: true });
    const segAbs = path.resolve(seg.file);
    const kOff = seg.offset - c.start;
    L.writeJson(path.join(ed, 'kills.json'), { clips: [{ file: segAbs, label: c.kills >= 5 ? 'ACE' : c.kills >= 3 ? `${c.kills}K` : '', kills: c.killTimes.map((t) => ({ t: +(t + kOff).toFixed(2) })) }] });
    L.writeJson(path.join(ed, 'estilo.json'), { preset: editPreset, ...(opt.music ? { music: { file: path.resolve(opt.music) } } : {}), output: { dir: ed, name: `${name}_edit` } });
    const b = await L.run(process.execPath, [path.join(CS2_SCRIPTS, 'build-plan.mjs'), '--style', path.join(ed, 'estilo.json'), '--kills', path.join(ed, 'kills.json'), '--out', path.join(ed, 'plan.json')]);
    const r = b.code === 0 ? await L.run(process.execPath, [path.join(CS2_SCRIPTS, 'render.mjs'), path.join(ed, 'plan.json'), ...(opt.preview ? ['--preview'] : [])]) : b;
    edit = r.code === 0 ? ed : null;
    if (!edit) console.log(`  AVISO: versão edit falhou: ${(r.stderr || '').slice(-300)}`);
  }
  const files = fs.readdirSync(work).filter((f) => /\.(mp4|jpg)$/.test(f) && f !== 'fonte.mp4').map((f) => path.join(work, f));
  console.log(`  ok: ${files.map((f) => path.basename(f)).join(', ')}`);
  manifest.push({ rank: c.rank, score: c.score, title: c.title, start: c.start, end: c.end, apex: c.apex, duration: dur, reasons: c.reasons, components: c.components,
    dir: work, files, edit, captions: caps.length, captionsReviewed: !!c.captions, layout: cfg.facecam ? 'facecam-em-cima' : (cfg.verticalSemCam || 'zoom') === 'zoom' ? 'jogo-zoom' : 'jogo-inteiro' });
}
// Re-render de alguns ranks (--ranks/--force) mantém os outros clipes já gerados cuja pasta ainda existe;
// pasta antiga do mesmo rank com outro título vai para clips/_antigos (não apaga nada).
const prev = fs.existsSync(path.join(dir, 'clips.json')) ? L.readJson(path.join(dir, 'clips.json')).clips || [] : [];
for (const p of prev) if (manifest.some((m) => m.rank === p.rank && m.dir !== p.dir) && fs.existsSync(p.dir)) {
  const dst = path.join(outRoot, '_antigos', path.basename(p.dir)); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.renameSync(p.dir, dst);
}
const kept = prev.filter((p) => !manifest.some((m) => m.rank === p.rank) && fs.existsSync(p.dir));
const all = [...kept, ...manifest].sort((a, b) => a.rank - b.rank);
L.writeJson(path.join(dir, 'clips.json'), { vod: C.vod, created: new Date().toISOString(), clips: all });
console.log(`\n${manifest.length} clipes em ${outRoot}`);
