#!/usr/bin/env node
// Agenda o modo autônomo no Agendador de Tarefas do Windows (só com a confirmação do usuário).
//   node schedule.mjs --every 30      (a cada 30 min: se a live acabou e há VOD nova, processa — "quando a live termina")
//   node schedule.mjs --daily 04:00   (uma vez por dia)
//   node schedule.mjs --status | --remove
// A tarefa roda "node auto.mjs --if-new" como o usuário atual, sem privilégios de administrador.
import path from 'node:path';
import { L, SKILL_DIR, parseArgs } from './lib.mjs';

const { opt } = parseArgs(process.argv.slice(2));
const NAME = 'TwitchAutoClipper';
if (process.platform !== 'win32') { console.log(`Fora do Windows, use o cron: */30 * * * * node "${path.join(SKILL_DIR, 'scripts', 'auto.mjs')}" --if-new`); process.exit(0); }
const sch = (args) => L.run('schtasks', args);
if (opt.status) { const r = await sch(['/Query', '/TN', NAME, '/V', '/FO', 'LIST']); console.log(r.code === 0 ? r.stdout : 'Nenhum agendamento criado.'); process.exit(0); }
if (opt.remove) { const r = await sch(['/Delete', '/TN', NAME, '/F']); console.log(r.code === 0 ? 'Agendamento removido.' : r.stderr); process.exit(0); }
const tr = `"${process.execPath}" "${path.join(SKILL_DIR, 'scripts', 'auto.mjs')}" --if-new`;
let args;
if (opt.daily) args = ['/Create', '/TN', NAME, '/TR', tr, '/SC', 'DAILY', '/ST', String(opt.daily), '/F'];
else args = ['/Create', '/TN', NAME, '/TR', tr, '/SC', 'MINUTE', '/MO', String(opt.every || 30), '/F'];
const r = await sch(args);
console.log(r.code === 0 ? `Agendado: ${opt.daily ? `todo dia às ${opt.daily}` : `a cada ${opt.every || 30} min`} → ${tr}\nRemover: node schedule.mjs --remove` : `Falhou: ${r.stderr}`);
