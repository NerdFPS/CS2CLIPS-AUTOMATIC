#!/usr/bin/env node
// Capa/thumbnail (1280x720 para YouTube, 1080x1920 para Shorts/TikTok) a partir de um quadro do vídeo:
// realça o quadro, escurece as bordas e escreve o título grande + subtítulo.
//   node make-cover.mjs video.mp4 --t 41.2 --title "ACE" [--sub "4K e ACE de SEU NICK"] [--out capa.jpg] [--vertical]
//   Sem --t: usa plan.json (--plan) para pegar o kill-herói (último kill do último clipe).
import path from 'node:path';
import fs from 'node:fs';
import * as L from './lib.mjs';

const { pos, opt } = L.parseArgs(process.argv.slice(2));
if (!pos[0] || !opt.title) { console.error('uso: node make-cover.mjs <video> --title "TEXTO" [--t segundos | --plan plan.json] [--sub "..."] [--out capa.jpg] [--vertical] [--color "#F2C230"]'); process.exit(1); }
await L.checkTools();
const video = path.resolve(pos[0]);
let t = opt.t !== undefined ? Number(opt.t) : null;
if (t === null && opt.plan) {
  const p = L.readJson(path.resolve(opt.plan));
  t = (p.hero || 0) + (p.titleCard?.duration || 0) - 0.1;
}
if (t === null) t = (await L.probe(video)).duration * 0.8;
const vertical = !!opt.vertical;
const [W, H] = vertical ? [1080, 1920] : [1280, 720];
const out = path.resolve(opt.out || video.replace(/\.mp4$/i, vertical ? '_capa_9x16.jpg' : '_capa.jpg'));
const work = fs.mkdtempSync(path.join(path.dirname(out), '.capa-'));
L.ensureFont(work, opt.font || null);
fs.writeFileSync(path.join(work, 't.txt'), opt.title);
if (opt.sub) fs.writeFileSync(path.join(work, 's.txt'), opt.sub);
const size = Math.round(H * (vertical ? 0.12 : 0.24));
const vf = [
  `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`,
  'eq=contrast=1.12:saturation=1.25:brightness=0.02', 'unsharp=5:5:0.8', 'vignette=PI/4',
  `drawtext=fontfile=font.ttf:textfile=t.txt:expansion=none:fontsize=${size}:fontcolor=${opt.color || 'white'}:borderw=${Math.round(size * 0.06)}:bordercolor=black:shadowcolor=black@0.6:shadowx=6:shadowy=6:x=(w-text_w)/2:y=${vertical ? 'h*0.18' : '(h-text_h)/2-h*0.05'}`,
  ...(opt.sub ? [`drawtext=fontfile=font.ttf:textfile=s.txt:expansion=none:fontsize=${Math.round(size * 0.32)}:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=${vertical ? 'h*0.18+' + size * 1.15 : 'h*0.72'}`] : []),
];
await L.ffmpeg(['-y', '-ss', String(Math.max(0, t)), '-i', video, '-frames:v', '1', '-vf', vf.join(','), '-q:v', '2', out], { cwd: work });
fs.rmSync(work, { recursive: true, force: true });
console.log(`✔ ${out}  (quadro em ${t.toFixed(2)}s)`);
