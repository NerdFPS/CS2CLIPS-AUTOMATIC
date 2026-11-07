#!/usr/bin/env node
// Lista as VODs (transmissões anteriores) do canal, mais recentes primeiro.
//   node list-vods.mjs [--channel login] [--n 10] [--all] [--json]
// Usa a API Helix quando há credenciais no .env; senão, o yt-dlp (sem login). --all inclui destaques e uploads.
import { loadConfig, listVods, parseArgs, hms, NO_VODS_HINT } from './lib.mjs';

const { opt } = parseArgs(process.argv.slice(2));
const cfg = loadConfig();
const vods = await listVods({ channel: opt.channel || cfg.channel, n: Number(opt.n || 10), all: !!opt.all });
if (opt.json) console.log(JSON.stringify(vods, null, 2));
else {
  if (!vods.length) console.log(NO_VODS_HINT);
  for (const v of vods) console.log(`${v.id}  ${(v.created || '').slice(0, 10)}  ${hms(v.duration || 0).padStart(8)}  ${v.live ? '[AO VIVO] ' : ''}${v.type && v.type !== 'archive' ? `[${v.type}] ` : ''}${v.title}`);
  if (vods.length) console.log(`(fonte: ${vods[0].source})`);
}
