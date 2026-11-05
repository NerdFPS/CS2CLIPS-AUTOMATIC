#!/usr/bin/env node
// Cópia leve de um vídeo para mandar no celular/WhatsApp/Discord (limite de upload). Calcula o bitrate
// para caber no tamanho pedido e reduz a resolução quando o bitrate ficaria baixo demais para ela.
//   node export-small.mjs video.mp4 [--mb 28] [--out video_celular.mp4]
import path from 'node:path';
import * as L from './lib.mjs';

const { pos, opt } = L.parseArgs(process.argv.slice(2));
if (!pos.length) { console.error('uso: node export-small.mjs <video...> [--mb 28] [--out arquivo]'); process.exit(1); }
await L.checkTools();
const mb = Number(opt.mb || 28);
const fsm = await import('node:fs');
for (const inp of pos.map((p) => path.resolve(p))) {
  if (/_celular\.mp4$/i.test(inp)) continue;
  const outPath = opt.out && pos.length === 1 ? path.resolve(opt.out) : inp.replace(/\.mp4$/i, '_celular.mp4');
  if (fsm.statSync(inp).size <= mb * 1048576) { // já cabe: só copia, nunca reencoda para maior
    fsm.copyFileSync(inp, outPath);
    console.log(`✔ ${outPath}  (já cabia: copiado sem reencodar)`);
    continue;
  }
  const info = await L.probe(inp);
  const audioK = 128;
  const vk = Math.floor((mb * 8192) / info.duration - audioK - 50);
  if (vk < 300) { console.error(`${path.basename(inp)}: longo demais para ${mb} MB (sobraria ${vk} kbps). Aumente --mb.`); continue; }
  const vertical = info.height > info.width;
  const long = Math.max(info.width, info.height);
  // ~ bitrate mínimo decente por resolução (60 fps): 1080p 4500k, 720p 1800k, 540p 900k
  const target = vk >= 4500 ? Math.min(long, 1920) : vk >= 1800 ? 1280 : vk >= 900 ? 960 : 854;
  const scale = vertical ? `scale=-2:${Math.min(target, long)}` : `scale=${Math.min(target, long)}:-2`;
  const fps = vk < 900 ? ',fps=30' : '';
  const out = opt.out && pos.length === 1 ? path.resolve(opt.out) : inp.replace(/\.mp4$/i, '_celular.mp4');
  const enc = (await L.canUseNvenc())
    ? ['-c:v', 'h264_nvenc', '-preset', 'p7', '-rc', 'vbr', '-b:v', `${vk}k`, '-maxrate', `${Math.round(vk * 1.3)}k`, '-bufsize', `${vk * 2}k`]
    : ['-c:v', 'libx264', '-preset', 'slow', '-b:v', `${vk}k`, '-maxrate', `${Math.round(vk * 1.3)}k`, '-bufsize', `${vk * 2}k`];
  await L.ffmpeg(['-y', '-i', inp, '-vf', `${scale}${fps}`, ...enc, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', `${audioK}k`, '-movflags', '+faststart', out]);
  const o = await L.probe(out);
  const size = (await import('node:fs')).statSync(out).size / 1048576;
  console.log(`✔ ${out}  ${o.width}x${o.height}  ${size.toFixed(1)} MB`);
}
