#!/usr/bin/env node
// Orquestador MCP (MVP) - bus de archivos sin dependencias
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';

const CONFIG_PATH = new URL('./config/agents.json', import.meta.url);

function loadConfig() {
  const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  return cfg;
}

function ensureDirs(root, agents) {
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  for (const a of agents) {
    const inb = join(root, `${a.name}.in`);
    const outb = join(root, `${a.name}.out`);
    if (!existsSync(inb)) mkdirSync(inb, { recursive: true });
    if (!existsSync(outb)) mkdirSync(outb, { recursive: true });
  }
}

function nowISO() { return new Date().toISOString(); }
function uuid() {
  // simple UUID v4 fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// --- Estado persistente (tasks + timeline) ---
function deriveStatePaths(cfg) {
  const root = process.env.MCP_STATE_ROOT || cfg.stateRoot || join(dirname(cfg.mailboxesRoot), 'state');
  const paths = {
    root,
    tasks: join(root, 'tasks.json'),
    timeline: join(root, 'timeline.jsonl')
  };
  return paths;
}

function ensureState(paths) {
  if (!existsSync(paths.root)) mkdirSync(paths.root, { recursive: true });
  if (!existsSync(paths.tasks)) writeFileSync(paths.tasks, JSON.stringify({ tasks: [] }, null, 2));
  if (!existsSync(paths.timeline)) writeFileSync(paths.timeline, '');
}

function loadTasks(paths) {
  try {
    const data = JSON.parse(readFileSync(paths.tasks, 'utf-8'));
    if (Array.isArray(data)) return { tasks: data }; // compat
    return data && typeof data === 'object' ? data : { tasks: [] };
  } catch {
    return { tasks: [] };
  }
}

function saveTasks(paths, data) {
  writeFileSync(paths.tasks, JSON.stringify(data, null, 2));
}

function appendTimeline(paths, record) {
  try {
    const line = JSON.stringify({ ts: nowISO(), ...record }) + '\n';
    appendFileSync(paths.timeline, line);
  } catch {}
}

function upsertTaskFromEnvelope(paths, envelope, source) {
  if (!envelope?.task?.id) return; // nada que actualizar
  const store = loadTasks(paths);
  const tId = envelope.task.id;
  let task = store.tasks.find(t => t.id === tId);
  if (!task) {
    // Crear registro si llega un evento sin creación local
    task = {
      id: tId,
      title: envelope.task.title || '',
      description: envelope.task.description || '',
      repo: envelope.task.repo || envelope.task?.repo || 'global',
      status: envelope.task.status || 'pending',
      createdAt: envelope.meta?.timestamp || nowISO(),
      updatedAt: envelope.meta?.timestamp || nowISO(),
      updates: []
    };
    store.tasks.push(task);
  }
  // Derivar status si corresponde
  const type = envelope.type || '';
  if (type === 'task.update') {
    const newStatus = envelope.payload?.status;
    if (typeof newStatus === 'string' && newStatus) task.status = newStatus;
    else if (!newStatus && task.status === 'pending') task.status = 'in_progress';
  }
  if (type.startsWith('result.')) {
    // Enriquecer con artefactos si vienen de proveedores (p.ej. blackbox, mistral)
    const prov = envelope.payload?.provider || envelope.payload?.result?.provider;
    if (prov === 'blackbox' || prov === 'mistral') {
      if (!task.artifacts) task.artifacts = {};
      // Normalizar forma de payload
      const p = envelope.payload?.structured ? envelope.payload : (envelope.payload?.result ? envelope.payload.result : envelope.payload);
      const artifact = {
        from: source || envelope.agent?.name || 'unknown',
        at: envelope.meta?.timestamp || nowISO(),
        kind: envelope.payload?.kind || p?.kind || 'review',
        provider: prov,
        model: p?.model || envelope.payload?.model,
        status: p?.status || undefined,
        structured: p?.structured || null,
        summary: typeof p?.content === 'string' ? (p.content.slice(0, 400)) : undefined
      };
      task.artifacts.lastReview = artifact;
      const version = artifact?.structured?.version || '';
      if (typeof version === 'string' && version.startsWith('mcp/changeset@')) {
        task.artifacts.lastChangeset = artifact.structured;
      }
    }
  }
  task.updatedAt = envelope.meta?.timestamp || nowISO();
  // Añadir update al historial
  task.updates.push({
    at: envelope.meta?.timestamp || nowISO(),
    from: source || envelope.agent?.name || 'unknown',
    type: envelope.type,
    payload: envelope.payload
  });
  saveTasks(paths, store);
}

function matchTarget(agent, target) {
  if (!target) return true;
  if (target.agents && !target.agents.includes(agent.name)) return false;
  if (target.roles && !target.roles.includes(agent.role)) return false;
  if (target.repos && agent.repos && target.repos.length) {
    const ok = target.repos.some(r => agent.repos.includes(r));
    if (!ok) return false;
  }
  return true;
}

function routeToAgents(cfg, envelope) {
  const { mailboxesRoot, agents } = cfg;
  const delivered = [];
  for (const a of agents) {
    if (matchTarget(a, envelope.target)) {
      const inb = join(mailboxesRoot, `${a.name}.in`);
      const file = join(inb, `${envelope.id}.json`);
      writeFileSync(file, JSON.stringify(envelope, null, 2));
      delivered.push(a.name);
    }
  }
  return delivered;
}

function collectOutgoing(cfg) {
  const { mailboxesRoot, agents } = cfg;
  const events = [];
  for (const a of agents) {
    const outb = join(mailboxesRoot, `${a.name}.out`);
    const files = existsSync(outb) ? readdirSync(outb) : [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const full = join(outb, f);
      try {
        const env = JSON.parse(readFileSync(full, 'utf-8'));
        events.push({ from: a.name, envelope: env, path: full });
      } catch {}
    }
  }
  return events;
}

function removeFile(path) {
  try { rmSync(path); } catch {}
}

function log(msg, data) {
  // Enviar logs operativos a stderr para no contaminar stdout (JSON de comandos)
  process.stderr.write(`[orchestrator] ${msg}${data ? ' ' + JSON.stringify(data) : ''}\n`);
}

// --- Blackbox API helpers for NL interface and summarization ---
const BB_API_URL = process.env.BLACKBOX_API_URL || 'https://api.blackbox.ai/v1/chat/completions';
const BB_API_KEY = process.env.BLACKBOX_API_KEY || '';
const BB_MODEL_DEFAULT = process.env.BLACKBOX_MODEL || 'blackboxai/anthropic/claude-3.7-sonnet';
const BB_MODEL_SUMMARY = process.env.BLACKBOX_MODEL_SUMMARY || 'blackboxai/anthropic/claude-3.5-haiku-20241022';
const BB_TEMPERATURE = process.env.BLACKBOX_TEMPERATURE;
const BB_TOP_P = process.env.BLACKBOX_TOP_P;
const BB_MAX_TOKENS = process.env.BLACKBOX_MAX_TOKENS;

async function callBlackbox(prompt, model) {
  if (!BB_API_KEY) throw new Error('BLACKBOX_API_KEY no configurada');
  if (typeof fetch !== 'function') throw new Error('fetch no disponible (Node < 18)');
  const body = { model: model || BB_MODEL_DEFAULT, messages: [{ role: 'user', content: prompt }] };
  if (BB_TEMPERATURE !== undefined) body.temperature = Number(BB_TEMPERATURE);
  if (BB_TOP_P !== undefined) body.top_p = Number(BB_TOP_P);
  if (BB_MAX_TOKENS !== undefined) body.max_tokens = Number(BB_MAX_TOKENS);
  const res = await fetch(BB_API_URL, {
    method: 'POST', headers: { 'content-type': 'application/json', 'authorization': `Bearer ${BB_API_KEY}` },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch {}
  const content = data?.choices?.[0]?.message?.content || data?.output || text;
  return { status: res.status, content, data, model: model || BB_MODEL_DEFAULT };
}

function tryExtractJson(text) {
  const m = text.match(/```json\s*([\s\S]*?)```/i);
  if (m) { try { return JSON.parse(m[1]); } catch {} }
  try { return JSON.parse(text); } catch {}
  return null;
}

function createTask({ title, description, repo, target }) {
  const env = {
    id: uuid(),
    type: 'task.create',
    agent: { name: 'system', role: 'orchestrator' },
    target: target || {},
    task: { id: uuid(), title, description, repo, status: 'pending' },
    payload: {},
    meta: { timestamp: nowISO(), version: '2.0', correlationId: uuid() }
  };
  return env;
}

function usage() {
  console.log(`Yega MCP Orchestrator (MVP)
Usage:
  node scripts/chispart-mcp/orchestrator.mjs init
  node scripts/chispart-mcp/orchestrator.mjs task "<title>" --repo <repo> [--roles role1,role2] [--agents a1,a2]
  node scripts/chispart-mcp/orchestrator.mjs pump   # recoge salidas y re‑rutea
  node scripts/chispart-mcp/orchestrator.mjs tasks list [--json]
  node scripts/chispart-mcp/orchestrator.mjs tasks show <taskId>
  node scripts/chispart-mcp/orchestrator.mjs tasks close <taskId> [--status done|cancelled]
  node scripts/chispart-mcp/orchestrator.mjs send change "<title>" --repo <repo> [--roles r1,r2] [--agents a1,a2] [--task <taskId>] [--payload '{"key":"val"}']
  node scripts/chispart-mcp/orchestrator.mjs nl task "<pedido NL>" [--repo <repo>] [--roles r1,r2] [--agents a1,a2]
  node scripts/chispart-mcp/orchestrator.mjs tasks report <taskId>
`);
}

function parseArgs(argv) {
  const [cmd, ...rest] = argv.slice(2);
  return { cmd, rest };
}

function parseFlags(arr) {
  const out = { _: [] };
  for (let i = 0; i < arr.length; i++) {
    const t = arr[i];
    if (t === '--repo') out.repo = arr[++i];
    else if (t === '--roles') out.roles = arr[++i];
    else if (t === '--agents') out.agents = arr[++i];
    else if (t === '--task') out.task = arr[++i];
    else if (t === '--payload') out.payload = arr[++i];
    else if (t === '--model') out.model = arr[++i];
    else if (t === '--prefix') out.prefix = arr[++i];
    else if (t === '--suffix') out.suffix = arr[++i];
    else out._.push(t);
  }
  return out;
}

function main() {
  const { cmd, rest } = parseArgs(process.argv);
  if (!cmd) { usage(); process.exit(0); }
  const cfg = loadConfig();
  ensureDirs(cfg.mailboxesRoot, cfg.agents);
  const statePaths = deriveStatePaths(cfg);
  ensureState(statePaths);

  if (cmd === 'init') {
    log('mailboxes ready', { root: cfg.mailboxesRoot });
    log('state ready', { root: statePaths.root });
    return;
  }

  if (cmd === 'task') {
    const flags = parseFlags(rest);
    const title = flags._.join(' ').trim().replace(/^"|"$/g, '');
    if (!title || !flags.repo) { usage(); process.exit(1); }
    const target = {};
    if (flags.roles) target.roles = flags.roles.split(',').map(s => s.trim());
    if (flags.agents) target.agents = flags.agents.split(',').map(s => s.trim());
    target.repos = [flags.repo];
    const env = createTask({ title, description: '', repo: flags.repo, target });
    const delivered = routeToAgents(cfg, env);
    log('task dispatched', { id: env.id, delivered });
    // Persistir creación de tarea y timeline
    upsertTaskFromEnvelope(statePaths, env, 'orchestrator');
    appendTimeline(statePaths, { event: 'task.create', envelope: env });
    return;
  }

  if (cmd === 'tasks') {
    const sub = rest[0] || 'list';
    if (sub === 'list') {
      const json = rest.includes('--json');
      const store = loadTasks(statePaths);
      if (json) {
        console.log(JSON.stringify(store.tasks, null, 2));
      } else {
        if (!store.tasks.length) { console.log('No hay tareas registradas.'); return; }
        for (const t of store.tasks) {
          console.log(`${t.id} | ${t.repo} | ${t.status} | ${t.title}`);
        }
      }
      return;
    }
    if (sub === 'show') {
      const id = rest[1];
      if (!id) { console.error('Falta taskId'); process.exit(1); }
      const store = loadTasks(statePaths);
      const t = store.tasks.find(x => x.id === id);
      if (!t) { console.error('Tarea no encontrada'); process.exit(1); }
      console.log(JSON.stringify(t, null, 2));
      return;
    }
    if (sub === 'close') {
      // Cierra una tarea con estado final (done|cancelled)
      // Uso: tasks close <taskId> [--status done|cancelled]
      const id = rest[1];
      if (!id) { console.error('Falta taskId'); process.exit(1); }
      // parse flag --status
      let status = 'done';
      for (let i = 2; i < rest.length; i++) {
        if (rest[i] === '--status' && rest[i + 1]) { status = rest[i + 1]; break; }
      }
      const allowed = new Set(['done', 'cancelled']);
      if (!allowed.has(status)) { console.error('Estado inválido. Usa --status done|cancelled'); process.exit(1); }

      const store = loadTasks(statePaths);
      const t = store.tasks.find(x => x.id === id);
      if (!t) { console.error('Tarea no encontrada'); process.exit(1); }

      const env = {
        id: uuid(),
        type: 'task.update',
        agent: { name: 'system', role: 'orchestrator' },
        target: { repos: [t.repo] },
        task: { id: t.id, title: t.title, description: t.description, repo: t.repo, status },
        payload: { status },
        meta: { timestamp: nowISO(), version: '2.0', correlationId: uuid() }
      };
      const delivered = routeToAgents(cfg, env);
      log('task closed', { id: t.id, status, delivered });
      // Persistir actualización y timeline
      upsertTaskFromEnvelope(statePaths, env, 'orchestrator');
      appendTimeline(statePaths, { event: 'task.update', envelope: env });
      return;
    }
    if (sub === 'report') {
      const id = rest[1];
      if (!id) { console.error('Falta taskId'); process.exit(1); }
      const store = loadTasks(statePaths);
      const t = store.tasks.find(x => x.id === id);
      if (!t) { console.error('Tarea no encontrada'); process.exit(1); }
      // Construir contexto para resumen
      const ctx = {
        task: { id: t.id, title: t.title, description: t.description, repo: t.repo, status: t.status },
        updates: t.updates?.slice(-20) || [],
        artifacts: t.artifacts || {}
      };
      const prompt = [
        'Eres un analista técnico. Resume y evalúa el estado de la tarea.',
        'Devuelve JSON válido en un bloque json con la estructura exacta:',
        '```json',
        '{"version":"mcp/result-summary@1","status":"in_progress|done|blocked|cancelled","summary":"...","highlights":["..."],"risks":["..."],"next_steps":["..."],"evidence":{"updates":N,"artifacts": ["lastReview","lastChangeset"]}}',
        '```',
        'Contexto:',
        JSON.stringify(ctx, null, 2)
      ].join('\n');
      (async () => {
        const { status, content, model } = await callBlackbox(prompt, BB_MODEL_SUMMARY);
        const structured = tryExtractJson(content);
        const summaryPayload = structured || { version: 'mcp/result-summary@1', status: t.status || 'in_progress', summary: String(content).slice(0, 2000) };
        // Guardar artefacto
        if (!t.artifacts) t.artifacts = {};
        t.artifacts.lastSummary = { provider: 'blackbox', model, status, structured: summaryPayload, at: nowISO() };
        saveTasks(statePaths, store);
        // Timeline
        appendTimeline(statePaths, { event: 'task.summary', envelope: { id: uuid(), type: 'result.summary', agent: { name: 'orchestrator', role: 'system' }, task: { id: t.id }, payload: { provider: 'blackbox', model, structured: summaryPayload }, meta: { timestamp: nowISO(), version: '2.0' } } });
        console.log(JSON.stringify(t.artifacts.lastSummary, null, 2));
      })().catch(e => { console.error('Resumen falló:', e?.message || e); process.exit(1); });
      return;
    }
    if (sub === 'plan') {
      const id = rest[1];
      if (!id) { console.error('Falta taskId'); process.exit(1); }
      const store = loadTasks(statePaths);
      const t = store.tasks.find(x => x.id === id);
      if (!t) { console.error('Tarea no encontrada'); process.exit(1); }
      const cs = t.artifacts?.lastChangeset;
      if (!cs || !Array.isArray(cs.patches)) { console.error('No hay changeset estructurado en artifacts.lastChangeset'); process.exit(1); }
      const plan = {
        version: 'mcp/pull-plan@1',
        repo: cs.repo || t.repo,
        steps: cs.patches.map((p, idx) => ({
          id: String(idx + 1),
          action: 'apply-patch',
          path: p.path,
          note: p.note || '',
        })),
        tests: cs.tests || [],
        notes: cs.notes || cs.plan || ''
      };
      if (!t.artifacts) t.artifacts = {};
      t.artifacts.pullPlan = plan;
      saveTasks(statePaths, store);
      appendTimeline(statePaths, { event: 'task.plan', envelope: { id: uuid(), type: 'result.plan', agent: { name: 'orchestrator', role: 'system' }, task: { id: t.id }, payload: { plan }, meta: { timestamp: nowISO(), version: '2.0' } } });
      console.log(JSON.stringify(plan, null, 2));
      return;
    }
    usage();
    return;
  }

  if (cmd === 'send') {
    const kind = rest[0];
    if (kind === 'change') {
      const flags = parseFlags(rest.slice(1));
      const title = flags._.join(' ').trim().replace(/^"|"$/g, '');
      if (!flags.repo) { console.error('Falta --repo'); process.exit(1); }
      if (!title && !flags.payload) { console.error('Falta título o --payload'); process.exit(1); }
      const target = {};
      if (flags.roles) target.roles = flags.roles.split(',').map(s => s.trim());
      if (flags.agents) target.agents = flags.agents.split(',').map(s => s.trim());
      target.repos = [flags.repo];

      // Resolver task
      let task;
      if (flags.task) {
        const store = loadTasks(statePaths);
        const t = store.tasks.find(x => x.id === flags.task);
        if (!t) { console.error('TaskId no encontrado para --task'); process.exit(1); }
        task = { id: t.id, title: t.title, description: t.description, repo: t.repo, status: t.status };
      } else {
        task = { id: uuid(), title: title || 'Change Request', description: '', repo: flags.repo, status: 'pending' };
      }

      // Payload: intentar parsear JSON si viene como tal, o usar string
      let payload = {};
      if (flags.payload) {
        try { payload = JSON.parse(flags.payload); }
        catch { payload = { note: String(flags.payload) }; }
      }
      // Opcional: FIM context para Codestral
      if (flags.prefix) payload.prefix = flags.prefix;
      if (flags.suffix) payload.suffix = flags.suffix;

      const env = {
        id: uuid(),
        type: 'change.request',
        agent: { name: 'system', role: 'orchestrator' },
        target,
        task,
        payload,
        meta: { timestamp: nowISO(), version: '2.0', correlationId: uuid() }
      };
      const delivered = routeToAgents(cfg, env);
      log('change dispatched', { id: env.id, taskId: task.id, delivered });
      upsertTaskFromEnvelope(statePaths, env, 'orchestrator');
      appendTimeline(statePaths, { event: 'change.request', envelope: env });
      return;
    }
    usage();
    return;
  }

  if (cmd === 'nl') {
    const kind = rest[0];
    if (kind === 'task') {
      const flags = parseFlags(rest.slice(1));
      const nl = flags._.join(' ').trim().replace(/^"|"$/g, '');
      if (!nl) { console.error('Falta descripción en lenguaje natural'); process.exit(1); }
      // Prompt para intención de tarea
      const prompt = [
        'Convierte la solicitud en intención de tarea para el orquestador MCP.',
        'Devuelve JSON válido en un bloque json con este esquema exacto:',
        '```json',
        '{"version":"mcp/task-intent@1","title":"...","description":"...","repo":"Yega-API","roles":["coordinator","qa"],"agents":[]}',
        '```',
        'Solicitud:',
        nl
      ].join('\n');
      (async () => {
        const { content, model } = await callBlackbox(prompt, BB_MODEL_DEFAULT);
        const intent = tryExtractJson(content) || {};
        // Mezclar overrides
        const repo = flags.repo || intent.repo || 'Yega-API';
        const roles = (flags.roles ? flags.roles.split(',').map(s => s.trim()) : (Array.isArray(intent.roles) ? intent.roles : []));
        const agents = (flags.agents ? flags.agents.split(',').map(s => s.trim()) : (Array.isArray(intent.agents) ? intent.agents : []));
        const title = intent.title || nl.slice(0, 80);
        const description = intent.description || nl;
        const target = {}; if (roles.length) target.roles = roles; if (agents.length) target.agents = agents; target.repos = [repo];
        const env = createTask({ title, description, repo, target });
        const delivered = routeToAgents(cfg, env);
        log('nl task dispatched', { id: env.id, title, repo, delivered, provider: 'blackbox', model });
        upsertTaskFromEnvelope(statePaths, env, 'orchestrator');
        appendTimeline(statePaths, { event: 'task.create', envelope: env });
        console.log(JSON.stringify({ created: true, taskId: env.task.id, title, repo, delivered }, null, 2));
      })().catch(e => { console.error('NL task falló:', e?.message || e); process.exit(1); });
      return;
    }
    usage();
    return;
  }

  if (cmd === 'pump') {
    const outgoing = collectOutgoing(cfg);
    if (!outgoing.length) { log('no outgoing events'); return; }
    for (const ev of outgoing) {
      // Filtrar ACKs y logs para evitar bucles y ruido
      const type = ev.envelope?.type || '';
      const isAck = type.endsWith('.ack');
      const isLog = type.startsWith('log.');
      // Siempre registrar en timeline y actualizar estado antes de descartar/reenviar
      appendTimeline(statePaths, { event: 'agent.out', from: ev.from, envelope: ev.envelope });
      try { upsertTaskFromEnvelope(statePaths, ev.envelope, ev.from); } catch {}
      if (isAck || isLog) {
        log('event dropped', { type, from: ev.from });
        removeFile(ev.path);
        continue;
      }
      // Simple re‑routing: forward to matching targets, avoid echo to sender
      const delivered = routeToAgents(cfg, ev.envelope).filter(a => a !== ev.from);
      log('event routed', { type: ev.envelope.type, from: ev.from, delivered });
      removeFile(ev.path);
    }
    return;
  }

  if (cmd === 'watch') {
    log('watch mode enabled');
    const tick = () => {
      const outgoing = collectOutgoing(cfg);
      for (const ev of outgoing) {
        const type = ev.envelope?.type || '';
        const isAck = type.endsWith('.ack');
        const isLog = type.startsWith('log.');
        appendTimeline(statePaths, { event: 'agent.out', from: ev.from, envelope: ev.envelope });
        try { upsertTaskFromEnvelope(statePaths, ev.envelope, ev.from); } catch {}
        if (isAck || isLog) {
          log('event dropped', { type, from: ev.from });
          removeFile(ev.path);
          continue;
        }
        const delivered = routeToAgents(cfg, ev.envelope).filter(a => a !== ev.from);
        log('event routed', { type: ev.envelope.type, from: ev.from, delivered });
        removeFile(ev.path);
      }
    };
    setInterval(tick, 1000);
    // keep process alive
    setInterval(() => {}, 1 << 30);
    return;
  }

  usage();
}

main();
