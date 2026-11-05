#!/usr/bin/env node
// Analisa os clipes brutos de CS2: duração, candidatos a kill (mudanças no killfeed +
// picos de áudio), folhas de contato do killfeed com carimbo de tempo, e cor média.
// Uso: node analyze-clips.mjs <pasta_ou_clipes...> [--out pasta] [--killfeed x,y,w,h]
import path from 'node:path';
import fs from 'node:fs';
import * as L from './lib.mjs';
import { DEFAULT_STYLE } from './defaults.mjs';

const { pos, opt } = L.parseArgs(process.argv.slice(2));
if (!pos.length) { console.error('uso: node analyze-clips.mjs <pasta_ou_clipes...> [--out pasta] [--killfeed x,y,w,h]'); process.exit(1); }
await L.checkTools();

const files = pos.flatMap((p) => L.listVideos(p));
if (!files.length) { console.error('Nenhum vídeo encontrado.'); process.exit(1); }
const out = path.resolve(opt.out || path.join(path.dirname(files[0]), '_analise_clipes'));
fs.mkdirSync(out, { recursive: true });
L.ensureFont(out, null);

const kf = { ...DEFAULT_STYLE.output.killfeed };
if (typeof opt.killfeed === 'string') {
  const [x, y, w, h] = opt.killfeed.split(',').map(Number);
  Object.assign(kf, { x, y, w, h });
}
const kfCrop = `crop=iw*${kf.w}:ih*${kf.h}:iw*${kf.x}:ih*${kf.y}`;

const clips = [];
for (const [ci, file] of files.entries()) {
  const id = String(ci + 1).padStart(2, '0');
  const dir = path.join(out, `clip_${id}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(out, 'font.ttf'), path.join(dir, 'font.ttf'));
  const info = await L.probe(file);
  console.log(`[${id}] ${path.basename(file)} — ${info.duration.toFixed(1)}s ${info.width}x${info.height} @ ${info.fps.toFixed(0)}fps`);

  // Killfeed: entradas novas mudam bastante a região recortada.
  const kfChanges = (await L.sceneScores(file, 0.08, `${kfCrop},`))
    .filter((s, i, arr) => i === 0 || s.t - arr[i - 1].t > 0.25)
    .map((s) => ({ t: +s.t.toFixed(2), score: +s.score.toFixed(3) }));

  // Picos de áudio (tiros).
  let peaks = [];
  if (info.hasAudio) peaks = L.rmsPeaks(await L.decodePcm(file, 22050), 22050);

  // Sinal principal: linhas com moldura vermelha (kills do próprio jogador).
  const red = await L.redKillfeedKills(file, kf);
  const shotBefore = (t) => peaks.some((p) => p.t <= t + 0.05 && t - p.t < 0.6);
  const candidates = kfChanges.map((c) => ({
    t: c.t,
    killfeedScore: c.score,
    shotJustBefore: shotBefore(c.t),
  }));
  const yourKills = red.kills.map((t) => ({ t, shotJustBefore: shotBefore(t) }));
  console.log(`     seus kills (moldura vermelha): ${yourKills.map((k) => k.t + 's').join(', ') || 'nenhum'}`);

  // Folhas de contato: killfeed a 4 fps (8 s por folha) e clipe inteiro a ~1 fps.
  await L.contactSheet(file, path.join(dir, 'killfeed_%02d.jpg'), { fps: 4, cols: 4, rows: 8, width: 360, crop: kfCrop, cwd: dir });
  const fullFps = Math.min(2, 20 / Math.max(1, info.duration));
  await L.contactSheet(file, path.join(dir, 'overview_%02d.jpg'), { fps: +fullFps.toFixed(4), cols: 5, rows: 4, width: 384, cwd: dir });
  fs.rmSync(path.join(dir, 'font.ttf'), { force: true });

  const st = (await L.signalStats(file, 5)).filter((f) => Number.isFinite(f.y));
  clips.push({
    id, file, info,
    yourKills,
    candidates,
    audioPeaks: peaks,
    look: {
      brightnessAvg: +L.mean(st.map((f) => f.y)).toFixed(1),
      saturationAvg: +L.mean(st.map((f) => f.sat)).toFixed(1),
      contrastAvg: +L.mean(st.map((f) => f.hi - f.lo)).toFixed(1),
    },
    images: fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort().map((f) => path.join(dir, f)),
  });
}

L.writeJson(path.join(out, 'clips-analysis.json'), { killfeedRegion: kf, clips });

// Rascunho de kills.json para ser conferido/corrigido.
const killsPath = path.join(out, 'kills.json');
if (!fs.existsSync(killsPath)) {
  L.writeJson(killsPath, {
    _instrucoes: 'Confira cada kill nas imagens killfeed_*.jpg. t = segundo do clipe em que o kill acontece. Os kills vêm da moldura vermelha (seus kills); se um clipe não tiver nenhum, os candidatos genéricos do killfeed estão em clips-analysis.json. Remova os falsos, ajuste os tempos, marque headshot, reordene os clipes (melhor por último) e preencha label (ex.: "ACE", "1v3 CLUTCH").',
    clips: clips.map((c) => ({
      file: c.file,
      label: c.yourKills.length >= 5 ? 'ACE' : '',
      kills: (c.yourKills.length ? c.yourKills : c.candidates).map((k) => ({ t: k.t, headshot: false, _conferir: true })),
    })),
  });
}

console.log(`\nAnálise: ${path.join(out, 'clips-analysis.json')}`);
console.log(`Rascunho de kills (CONFERIR): ${killsPath}`);
console.log('Olhe killfeed_*.jpg de cada clipe para confirmar os kills (o carimbo amarelo é o tempo no clipe).');
