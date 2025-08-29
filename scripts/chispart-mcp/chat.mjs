#!/usr/bin/env node
// Chat CLI (MVP) – interfaz natural sobre el orquestador usando Blackbox
// - Crea/adjunta sesiones persistentes en .mcp/chats/<sessionId>
// - Interpreta entradas NL → intent JSON → ejecuta acciones contra el orquestador
// - Modo watch: muestra actualizaciones de timeline periódicamente

import { mkdirSync, existsSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from 'fs';
import { join } from 'path';
import readline from 'readline';
import { spawnSync } from 'child_process';

const ROOT = process.cwd();
const CHATS_ROOT = join(ROOT, '.mcp', 'chats');
const STATE_ROOT = process.env.MCP_STATE_ROOT || join(ROOT, '.mcp', 'state');
const TIMELINE = join(STATE_ROOT, 'timeline.jsonl');

// Blackbox config (usa tu .env cargado por el wrapper normalmente)
const BB_API_URL = process.env.BLACKBOX_API_URL || 'https://api.blackbox.ai/v1/chat/completions';
const BB_API_KEY = process.env.BLACKBOX_API_KEY || '';
const BB_MODEL = process.env.BLACKBOX_MODEL || process.env.BLACKBOX_MODEL_SUMMARY || 'blackboxai/anthropic/claude-3.5-haiku';

function nowISO() { return new Date().toISOString(); }
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0; const v = c === 'x' ? r : (r & 0x3 | 0x8); return v.toString(16);
  });
}

function ensureDirs() { if (!existsSync(CHATS_ROOT)) mkdirSync(CHATS_ROOT, { recursive: true }); }

function loadAgentsRepos() {
  try {
    const cfgPath = new URL('./config/agents.json', import.meta.url);
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
    const repos = new Set();
    for (const a of cfg.agents || []) for (const r of (a.repos || [])) repos.add(r);
    return Array.from(repos);
  } catch { return []; }
}

async function callBlackbox(prompt) {
  if (!BB_API_KEY) throw new Error('BLACKBOX_API_KEY no configurada');
  const body = { model: BB_MODEL, messages: [{ role: 'user', content: prompt }] };
  const res = await fetch(BB_API_URL, { method: 'POST', headers: { 'content-type': 'application/json', 'authorization': `Bearer ${BB_API_KEY}` }, body: JSON.stringify(body) });
  const text = await res.text(); let data = null; try { data = JSON.parse(text); } catch {}
  const content = data?.choices?.[0]?.message?.content || data?.output || text; return content;
}

async function explain(kind, data, options = {}) {
  // Genera una explicación en español breve y accionable usando Blackbox
  const style = options.style || 'breve y accionable';
  const prompt = [
    'Eres un asistente técnico. Explica resultados de orquestación de tareas en español, de forma ' + style + '.',
    'No devuelvas JSON ni markdown, solo texto claro con bullets cuando convenga.',
    `Contexto (${kind}):`,
    typeof data === 'string' ? data : JSON.stringify(data, null, 2)
  ].join('\n\n');
  const content = await callBlackbox(prompt);
  // Remueve fences si el proveedor devolviera alguno por error
  return String(content).replace(/```[a-z]*\n?|```/gi, '').trim();
}

function tryExtractJson(text) {
  const m = text.match(/```json\s*([\s\S]*?)```/i); if (m) { try { return JSON.parse(m[1]); } catch {} }
  try { return JSON.parse(text); } catch {} return null;
}

function runOrch(args, { json = false } = {}) {
  const cmd = ['node', 'scripts/chispart-mcp/orchestrator.mjs', ...args];
  const res = spawnSync(cmd[0], cmd.slice(1), { encoding: 'utf-8' });
  const out = (res.stdout || '').trim(); const err = (res.stderr || '').trim();
  return { ok: res.status === 0, stdout: out, stderr: err, json: json ? safeJson(out) : null };
}

function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

function writeSession(session, obj) {
  const dir = join(CHATS_ROOT, session); if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, 'log.jsonl'), JSON.stringify({ ts: nowISO(), ...obj }) + '\n');
}

function latestTimelineSince(ts) {
  try {
    const data = readFileSync(TIMELINE, 'utf-8').trim().split('\n');
    const out = []; for (const line of data.slice(-200)) { try { const j = JSON.parse(line); if (!ts || j.ts > ts) out.push(j); } catch {} }
    return out;
  } catch { return []; }
}

function usage() {
  console.log(`Chat CLI (Blackbox NL)
Usage:
  node scripts/chispart-mcp/chat.mjs new              # crea nueva sesión
  node scripts/chispart-mcp/chat.mjs attach <session>  # adjunta a sesión
`);
}

async function main() {
  ensureDirs();
  const [, , cmd, sid] = process.argv;
  if (!cmd || (cmd !== 'new' && cmd !== 'attach')) { usage(); process.exit(0); }
  const session = cmd === 'new' ? uuid() : sid;
  if (!session) { console.error('Falta sessionId'); process.exit(1); }
  const sessionDir = join(CHATS_ROOT, session); if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });
  const repos = loadAgentsRepos();

  console.error(`[chat] session=${session}. Escribe en lenguaje natural. 'exit' para salir. Usa '/help' para comandos rápidos.`);
  writeSession(session, { event: 'session.start', session, repos });

  let watch = true; // ver eventos en vivo
  let watchMode = 'summary'; // 'summary' | 'detailed'
  let lastTs = nowISO(); // iniciar desde ahora (sin backfill)
  let filterMode = 'default';
  const buffer = []; // acumula eventos recientes para resumir
  const isInteresting = (type) => {
    if (filterMode === 'all') return true;
    return type && (
      type.startsWith('task.create') ||
      type.startsWith('task.update') ||
      type.startsWith('result.review') ||
      type.startsWith('result.summary') ||
      type.startsWith('change.request')
    );
  };
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });

  const help = `Puedes pedir en NL: crear tarea, listar tareas, mostrar tarea <id>, cerrar tarea <id>, reporte <id>, plan <id>, enviar cambio <titulo> --repo <repo>.
Comandos rápidos:
  /watch on | /watch off     Enciende/apaga actualizaciones en vivo
  /filter default | /filter all   Cambia el filtro de eventos del watch
  /pump                    Recolecta eventos ahora
  /help                    Muestra esta ayuda
  /exit                    Cierra el chat`;

  const sys = `Convierte la solicitud del usuario en un JSON (en bloque \`\`\`json) con el siguiente esquema exacto:
{"version":"mcp/chat-intent@1","action":"list_tasks|show_task|create_task|send_change|close_task|report_task|plan_task|pump|watch_on|watch_off|help|exit","args":{}}
Campos args por acción:
- create_task: {"title":"...","repo":"...","roles":["coordinator","qa"]}
- send_change: {"title":"...","repo":"...","roles":["analysis","dev-support"],"payload":{}}
- show_task/close_task/report_task/plan_task: {"taskId":"..."}
- list_tasks/pump/watch_on/watch_off/help/exit: {}.
Repos válidos: ${repos.join(', ')}.
`;

  const interval = setInterval(() => {
    if (!watch) return; const events = latestTimelineSince(lastTs); if (events.length) { lastTs = events[events.length - 1].ts; for (const e of events) {
      const type = e?.envelope?.type || e.event; const from = e.from || e.envelope?.agent?.name || 'orchestrator';
      if (!isInteresting(type)) continue;
      if (watchMode === 'detailed') {
        console.error(`[watch] ${type} from=${from}`);
      }
      buffer.push({ ts: e.ts, type, from, taskId: e?.envelope?.task?.id });
      writeSession(session, { event: 'watch', type, from });
    } }
  }, 1500);

  // Resumen periódico de eventos (cada ~5s)
  const summaryIntervalMs = 5000;
  const summarizer = setInterval(async () => {
    if (!watch || watchMode !== 'summary') return;
    if (!buffer.length) return;
    const take = buffer.splice(0, buffer.length);
    const byType = take.reduce((acc, ev) => { acc[ev.type] = (acc[ev.type] || 0) + 1; return acc; }, {});
    const byFrom = take.reduce((acc, ev) => { acc[ev.from] = (acc[ev.from] || 0) + 1; return acc; }, {});
    const tasks = Array.from(new Set(take.map(ev => ev.taskId).filter(Boolean)));
    const payload = { window_ms: summaryIntervalMs, total: take.length, byType, byFrom, tasks };
    try {
      const msg = await explain('watch.summary', payload, { style: 'breve y con conteos y próximos pasos' });
      console.error(msg);
      writeSession(session, { event: 'watch.summary', payload });
    } catch (e) {
      // Fallback mínimo sin NL
      console.error(`[watch] ${take.length} eventos: tipos=${Object.keys(byType).length}, agentes=${Object.keys(byFrom).length}`);
    }
  }, summaryIntervalMs);

  async function handle(line) {
    const text = String(line || '').trim(); if (!text) return; if (text.toLowerCase() === 'exit') { rl.close(); return; }
    if (text.toLowerCase() === 'help' || text === '/help') { console.log(help); return; }
    // Comandos slash inmediatos
    if (text.startsWith('/')) {
      const parts = text.slice(1).trim().split(/\s+/);
      const cmd = parts[0] || '';
      if (cmd === 'watch') {
        const val = (parts[1] || '').toLowerCase();
        if (val === 'on') { watch = true; console.log('watch: on'); }
        else if (val === 'off') { watch = false; console.log('watch: off'); }
        else if (val === 'mode') {
          const mode = (parts[2] || '').toLowerCase();
          if (mode === 'summary' || mode === 'detailed') { watchMode = mode; console.log(`watch mode: ${watchMode}`); }
          else { console.log('Uso: /watch mode summary|detailed'); }
        }
        else { console.log('Uso: /watch on|off | /watch mode summary|detailed'); }
        return;
      }
      if (cmd === 'filter') {
        const val = (parts[1] || '').toLowerCase();
        if (val === 'default' || val === 'all') { filterMode = val; console.log(`filter: ${filterMode}`); }
        else { console.log('Uso: /filter default|all'); }
        return;
      }
      if (cmd === 'pump') { runOrch(['pump']); console.log('pump: ok'); return; }
      if (cmd === 'exit') { rl.close(); return; }
      // desconocido
      console.log('Comando no reconocido. Usa /help');
      return;
    }
    try {
      const content = await callBlackbox(sys + '\nUsuario: ' + text);
      const intent = tryExtractJson(content) || {};
      writeSession(session, { event: 'intent', raw: content, intent });
      const a = intent.action || '';
      switch (a) {
        case 'list_tasks': {
          const r = runOrch(['tasks', 'list', '--json'], { json: true });
          const msg = await explain('tasks.list', r.json || r.stdout);
          console.log(msg); break;
        }
        case 'show_task': {
          const id = intent.args?.taskId; if (!id) { console.log('{"error":"Falta taskId"}'); break; }
          const r = runOrch(['tasks', 'show', id]);
          const obj = safeJson(r.stdout) || r.stdout;
          const msg = await explain('tasks.show', obj);
          console.log(msg); break;
        }
        case 'create_task': {
          const title = intent.args?.title || text; const repo = intent.args?.repo || repos[0] || 'global';
          const roles = Array.isArray(intent.args?.roles) && intent.args.roles.length ? intent.args.roles.join(',') : '';
          const r = roles ? runOrch(['task', title, '--repo', repo, '--roles', roles]) : runOrch(['task', title, '--repo', repo]);
          const msg = await explain('task.create', { title, repo, roles: roles || '(default)' });
          console.log(msg); break;
        }
        case 'send_change': {
          const title = intent.args?.title || text; const repo = intent.args?.repo || repos[0] || 'global';
          const roles = Array.isArray(intent.args?.roles) && intent.args.roles.length ? intent.args.roles.join(',') : '';
          const payload = intent.args?.payload ? JSON.stringify(intent.args.payload) : '{}';
          const args = ['send', 'change', title, '--repo', repo]; if (roles) args.push('--roles', roles); args.push('--payload', payload);
          const r = runOrch(args);
          const msg = await explain('change.request', { title, repo, roles: roles || '(default)', payload: safeJson(payload) || payload });
          console.log(msg); break;
        }
        case 'close_task': {
          const id = intent.args?.taskId; if (!id) { console.log('{"error":"Falta taskId"}'); break; }
          const r = runOrch(['tasks', 'close', id, '--status', 'done']);
          const msg = await explain('task.close', { taskId: id, status: 'done' });
          console.log(msg); break;
        }
        case 'report_task': {
          const id = intent.args?.taskId; if (!id) { console.log('{"error":"Falta taskId"}'); break; }
          const r = runOrch(['tasks', 'report', id]);
          const obj = safeJson(r.stdout) || r.stdout;
          const msg = await explain('tasks.report', obj);
          console.log(msg); break;
        }
        case 'plan_task': {
          const id = intent.args?.taskId; if (!id) { console.log('{"error":"Falta taskId"}'); break; }
          const r = runOrch(['tasks', 'plan', id]);
          const obj = safeJson(r.stdout) || r.stdout;
          const msg = await explain('tasks.plan', obj);
          console.log(msg); break;
        }
        case 'pump': { const r = runOrch(['pump']); console.log('{"pump":true}'); break; }
        case 'watch_on': { watch = true; console.log('{"watch":"on"}'); break; }
        case 'watch_off': { watch = false; console.log('{"watch":"off"}'); break; }
        case 'help': { console.log(help); break; }
        case 'exit': { rl.close(); break; }
        default: { console.log('{"info":"No se reconoció la intención; pide \"help\""}'); }
      }
    } catch (e) {
      console.log(JSON.stringify({ error: String(e?.message || e) }));
    }
  }

  rl.setPrompt('> '); rl.prompt();
  rl.on('line', async (line) => { await handle(line); rl.prompt(); });
  rl.on('close', () => { clearInterval(interval); clearInterval(summarizer); writeSession(session, { event: 'session.end' }); process.exit(0); });
}

main();
