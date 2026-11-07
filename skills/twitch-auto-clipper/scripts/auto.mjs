#!/usr/bin/env node
// Modo autônomo: processa a VOD mais recente do canal (ou uma específica) de ponta a ponta —
// baixar → analisar → gerar os N melhores clipes → relatório. Só gera arquivos: nunca posta nem cria clipe na Twitch.
//   node auto.mjs [--vod ID] [--if-new] [--top 6] [--edit zuhn] [--channel login] [--no-notify]
// --if-new: sai sem fazer nada se a última VOD já foi processada ou se a live ainda está no ar (para o agendador).
// Estado: <dataDir>/processed.json · Log: <dataDir>/auto.log · Trava: <dataDir>/auto.lock
import fs from 'node:fs';
import path from 'node:path';
import { L, SKILL_DIR, loadConfig, parseArgs, listVods, NO_VODS_HINT } from './lib.mjs';

const { opt } = parseArgs(process.argv.slice(2));
const cfg = loadConfig();
const channel = opt.channel || cfg.channel;
fs.mkdirSync(cfg.dataDir, { recursive: true });
const logF = path.join(cfg.dataDir, 'auto.log');
const log = (m) => { const l = `${new Date().toISOString()} ${m}`; console.log(l); fs.appendFileSync(logF, l + '\n'); };
const lock = path.join(cfg.dataDir, 'auto.lock');
if (fs.existsSync(lock) && Date.now() - fs.statSync(lock).mtimeMs < 6 * 3600e3) { console.log('Outra execução está rodando (auto.lock). Saindo.'); process.exit(0); }
fs.writeFileSync(lock, String(process.pid));
const stateF = path.join(cfg.dataDir, 'processed.json');
const state = fs.existsSync(stateF) ? L.readJson(stateF) : {};
const step = async (script, args) => {
  log(`→ ${script} ${args.join(' ')}`);
  const r = await L.run(process.execPath, [path.join(SKILL_DIR, 'scripts', script), ...args]);
  fs.appendFileSync(logF, r.stdout + (r.code ? r.stderr : ''));
  if (r.code !== 0) throw new Error(`${script} falhou (código ${r.code}): ${r.stderr.slice(-600)}`);
  return r.stdout;
};
async function main() {
  let vod = opt.vod ? String(opt.vod).match(/\d+/)[0] : null;
  if (!vod) {
    const vods = await listVods({ channel, n: 5 });
    const v = vods.find((x) => !x.live);
    if (!v) { log(vods.length ? 'A única VOD recente ainda está ao vivo. Tento de novo depois.' : NO_VODS_HINT); return; }
    vod = v.id;
    if (opt['if-new'] && state[vod]?.status === 'ok') { log(`VOD ${vod} já processada. Nada a fazer.`); return; }
  }
  log(`Processando VOD ${vod} do canal ${channel}`);
  state[vod] = { status: 'rodando', started: new Date().toISOString() }; L.writeJson(stateF, state);
  await step('fetch-vod.mjs', [vod]);
  await step('analyze-vod.mjs', [vod]);
  await step('make-clips.mjs', [vod, '--top', String(opt.top || cfg.topN), ...(opt.edit || cfg.edit ? ['--edit', opt.edit || cfg.edit] : [])]);
  await step('report.mjs', [vod]);
  state[vod] = { ...state[vod], status: 'ok', finished: new Date().toISOString(), report: path.join(cfg.dataDir, vod, 'report.md') };
  log(`Pronto: ${state[vod].report}`);
  // Aviso opcional na área de trabalho (Windows), sem depender de nada além do PowerShell
  if (process.platform === 'win32' && !opt['no-notify']) {
    await L.run('powershell', ['-NoProfile', '-Command', `[reflection.assembly]::loadwithpartialname('System.Windows.Forms')|Out-Null; $n=New-Object System.Windows.Forms.NotifyIcon; $n.Icon=[System.Drawing.SystemIcons]::Information; $n.Visible=$true; $n.ShowBalloonTip(8000,'twitch-auto-clipper','Clipes da VOD ${vod} prontos (nada foi postado).',[System.Windows.Forms.ToolTipIcon]::Info); Start-Sleep 9; $n.Dispose()`]);
  }
}
try {
  await main();
} catch (e) {
  log(`ERRO: ${e.message}`);
  if (state && Object.keys(state).length) { const k = Object.keys(state).find((x) => state[x].status === 'rodando'); if (k) state[k].status = 'erro'; }
  process.exitCode = 1;
} finally {
  L.writeJson(stateF, state);
  fs.rmSync(lock, { force: true });
}
