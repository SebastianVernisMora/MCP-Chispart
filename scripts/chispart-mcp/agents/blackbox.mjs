#!/usr/bin/env node
// Blackbox adapter (MVP): integra con API externa usando API Key
// No asume endpoints exactos; todo configurable vía env vars.
// Requiere Node >= 18 (fetch global) o proveer polyfill.

import { readdirSync, readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const AGENT_NAME = process.env.MCP_AGENT_NAME || 'blackbox';
const ROLE = process.env.MCP_AGENT_ROLE || 'dev-support';
const ROOT = process.env.MCP_MAILBOX_ROOT || '.mcp/mailboxes';
const INBOX = join(ROOT, `${AGENT_NAME}.in`);
const OUTBOX = join(ROOT, `${AGENT_NAME}.out`);

// Config API (ajusta a tu proveedor real)
const BB_API_URL = process.env.BLACKBOX_API_URL || 'https://api.blackbox.ai/v1/chat/completions';
const BB_API_KEY = process.env.BLACKBOX_API_KEY || '';
// Modelos por tipo de evento (con fallback a uno general)
const BB_MODEL_DEFAULT = process.env.BLACKBOX_MODEL || 'blackboxai/anthropic/claude-3.7-sonnet';
const BB_MODEL_TASK = process.env.BLACKBOX_MODEL_TASK || BB_MODEL_DEFAULT;
const BB_MODEL_CHANGE = process.env.BLACKBOX_MODEL_CHANGE || BB_MODEL_DEFAULT;
const BB_MODEL_SUMMARY = process.env.BLACKBOX_MODEL_SUMMARY || 'blackboxai/anthropic/claude-3.5-haiku-20241022';

// Opciones de generación (opcionales)
const BB_TEMPERATURE = process.env.BLACKBOX_TEMPERATURE;
const BB_TOP_P = process.env.BLACKBOX_TOP_P;
const BB_MAX_TOKENS = process.env.BLACKBOX_MAX_TOKENS;

function ensure() {
  if (!existsSync(INBOX)) mkdirSync(INBOX, { recursive: true });
  if (!existsSync(OUTBOX)) mkdirSync(OUTBOX, { recursive: true });
}

function nowISO() { return new Date().toISOString(); }

function outEnvelope(inEnv, type, payload) {
  return {
    id: inEnv.id,
    type,
    agent: { name: AGENT_NAME, role: ROLE },
    target: inEnv.target,
    task: inEnv.task,
    payload,
    meta: { ...inEnv.meta, timestamp: nowISO() }
  };
}

function writeOut(env) {
  const file = join(OUTBOX, `${env.id}-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(env, null, 2));
}

const BASE_CONTEXT = `Ecosistema Yega (Node/TS/Express, React/Vite/Tailwind, Prisma, Vitest). 
Sigue convenciones del repo (kebab-case, PascalCase para componentes, etc.).
Respeta la política multi-repo: propone cambios solo en el repo objetivo (task.repo).`;

function buildPrompt(envelope) {
  const { type, task, payload } = envelope;
  const repo = task?.repo || 'global';
  const title = task?.title || '';
  const desc = task?.description || '';
  const checklist = (task?.checklist || [])
    .map(i => `- [${i.done ? 'x' : ' '}] ${i.text}`).join('\n');
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload || {}, null, 2);

  const commonHeader = [
    BASE_CONTEXT,
    `Evento=${type} | Repo=${repo}`,
    title && `Tarea: ${title}`,
    desc && `Descripción: ${desc}`,
    checklist && `Checklist:\n${checklist}`,
    input && `Contexto/Payload:\n${input}`
  ].filter(Boolean).join('\n\n');

  if (type === 'task.create') {
    return [
      commonHeader,
      'Objetivo: Entrega un análisis técnico y un plan accionable.',
      '- Secciones requeridas: resumen breve, riesgos, plan paso a paso, pruebas sugeridas (Vitest/Supertest o RTL), impactos en DX/seguridad.',
      '- Formato de salida: JSON (ver bloque) más un resumen en texto.',
      '```json\n{"version":"mcp/analysis@1","summary":"...","risks":["..."],"plan":["..."],"tests":[{"area":"api","notes":"..."}]}\n```'
    ].join('\n\n');
  }

  if (type === 'change.request') {
    return [
      commonHeader,
      'Objetivo: Proponer cambios de código listos para PR.',
      '- Entrega un changeset JSON estricto y opcionalmente un diff unificado.',
      '- Solo toca archivos del repo indicado. No incluir secretos.',
      '- Si agregas dependencias, justifica y limita el alcance.',
      'Formato JSON requerido (bloque exacto):',
      '```json\n{"version":"mcp/changeset@1","repo":"REPO","plan":"...","patches":[{"path":"src/file.ts","patch":"--- a/src/file.ts\\n+++ b/src/file.ts\\n@@\\n- old\\n+ new\\n","note":"motivo del cambio"}],"tests":["comando o enfoque"],"notes":"consideraciones"}\n```\nSi también incluyes diff en texto, usa formato unified diff estándar.'
    ].join('\n\n');
  }

  if (type === 'handoff.create') {
    return [
      commonHeader,
      'Objetivo: Preparar handoff claro entre repos/agentes.',
      '- Entrega cuerpo de issue/PR con checklist y criterios de aceptación.',
      'Formato JSON sugerido:',
      '```json\n{"version":"mcp/handoff@1","title":"...","body":"...","checklist":["..."],"acceptance":["..."],"labels":["handoff","mcp"]}\n```'
    ].join('\n\n');
  }

  // Default: logging/summary
  return [
    commonHeader,
    'Objetivo: Resumir y proponer próximos pasos concisos.'
  ].join('\n\n');
}

function tryExtractJson(text) {
  // Busca primer bloque ```json ... ``` o intenta parsear todo
  const blockMatch = text.match(/```json\s*([\s\S]*?)```/i);
  if (blockMatch) {
    try { return JSON.parse(blockMatch[1]); } catch {}
  }
  try { return JSON.parse(text); } catch {}
  return null;
}

function pickModelForEnvelope(envelope) {
  switch (envelope.type) {
    case 'task.create':
      return BB_MODEL_TASK;
    case 'change.request':
      return BB_MODEL_CHANGE;
    case 'task.update':
    case 'result.test':
    case 'result.build':
    case 'result.review':
    case 'handoff.create':
      return BB_MODEL_SUMMARY;
    default:
      return BB_MODEL_DEFAULT;
  }
}

async function callBlackbox(prompt, model) {
  if (!BB_API_KEY) throw new Error('BLACKBOX_API_KEY no configurada');
  if (typeof fetch !== 'function') throw new Error('fetch no disponible (Node < 18)');

  const body = { model, messages: [{ role: 'user', content: prompt }] };
  if (BB_TEMPERATURE !== undefined) body.temperature = Number(BB_TEMPERATURE);
  if (BB_TOP_P !== undefined) body.top_p = Number(BB_TOP_P);
  if (BB_MAX_TOKENS !== undefined) body.max_tokens = Number(BB_MAX_TOKENS);
  const res = await fetch(BB_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${BB_API_KEY}`
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return { status: res.status, text, data };
}

async function handle(envelope) {
  // Para tipos principales, generamos análisis/sugerencias
  const prompt = buildPrompt(envelope);
  try {
    const model = pickModelForEnvelope(envelope);
    const { status, text, data } = await callBlackbox(prompt, model);
    const content = data?.choices?.[0]?.message?.content || data?.output || text;
    // Intentar extraer JSON estructurado (analysis/changeset/handoff)
    const json = typeof content === 'string' ? tryExtractJson(content) : null;
    // Construir resultado con preferencia por payload estructurado
    const result = json ? { provider: 'blackbox', model, status, structured: json, content } : { provider: 'blackbox', model, status, content };
    switch (envelope.type) {
      case 'task.create':
        writeOut(outEnvelope(envelope, 'result.review', { ...result, kind: 'analysis' }));
        break;
      case 'change.request':
        writeOut(outEnvelope(envelope, 'result.review', { ...result, kind: json?.version?.startsWith?.('mcp/changeset') ? 'changeset' : 'change-plan' }));
        break;
      default:
        writeOut(outEnvelope(envelope, 'log.info', { message: 'processed', result }));
    }
  } catch (e) {
    writeOut(outEnvelope(envelope, 'log.error', { provider: 'blackbox', error: String(e?.message || e) }));
  }
}

async function loopOnce() {
  const files = existsSync(INBOX) ? readdirSync(INBOX) : [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const full = join(INBOX, f);
    try {
      const env = JSON.parse(readFileSync(full, 'utf-8'));
      await handle(env);
    } catch (e) {
      writeOut({ id: 'unknown', type: 'log.error', agent: { name: AGENT_NAME, role: ROLE }, meta: { timestamp: nowISO(), version: '2.0' }, payload: { error: String(e) } });
    }
    try { rmSync(full); } catch {}
  }
}

async function main() {
  ensure();
  const interval = Number(process.env.MCP_POLL_MS || '1500');
  console.log(`[${AGENT_NAME}] adapter running; inbox=${INBOX}, outbox=${OUTBOX}`);
  await loopOnce();
  setInterval(() => { loopOnce(); }, interval);
}

main();
