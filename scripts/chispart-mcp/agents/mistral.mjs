#!/usr/bin/env node
// Mistral adapter (MVP): integra con API nativa de Mistral
// Requiere Node >= 18 (fetch global)

import { readdirSync, readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const AGENT_NAME = process.env.MCP_AGENT_NAME || 'mistral';
const ROLE = process.env.MCP_AGENT_ROLE || 'dev-support';
const ROOT = process.env.MCP_MAILBOX_ROOT || '.mcp/mailboxes';
const INBOX = join(ROOT, `${AGENT_NAME}.in`);
const OUTBOX = join(ROOT, `${AGENT_NAME}.out`);

// Config API
// Preferir endpoints Codestral por defecto (según consola/documentación)
const MS_API_URL = process.env.MISTRAL_API_URL || 'https://codestral.mistral.ai/v1/chat/completions';
const MS_API_KEY = process.env.MISTRAL_API_KEY || '';
// Codestral (FIM) endpoint opcional
const MS_CODESTRAL_URL = process.env.MISTRAL_CODESTRAL_URL || 'https://codestral.mistral.ai/v1/fim/completions';
const MS_USE_CODESTRAL = (process.env.MISTRAL_USE_CODESTRAL || 'true').toLowerCase() !== 'false';

// Modelos por tipo de evento (con fallback a uno general)
const MS_MODEL_DEFAULT = process.env.MISTRAL_MODEL || 'mistral-large-latest';
const MS_MODEL_TASK = process.env.MISTRAL_MODEL_TASK || MS_MODEL_DEFAULT;
const MS_MODEL_CHANGE = process.env.MISTRAL_MODEL_CHANGE || 'codestral-latest';
const MS_MODEL_SUMMARY = process.env.MISTRAL_MODEL_SUMMARY || 'mistral-small-latest';

// Opciones de generación (opcionales)
const MS_TEMPERATURE = process.env.MISTRAL_TEMPERATURE;
const MS_TOP_P = process.env.MISTRAL_TOP_P;
const MS_MAX_TOKENS = process.env.MISTRAL_MAX_TOKENS;

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

const BASE_CONTEXT = `Ecosistema Yega (Node/TS/Express, React/Vite/Tailwind, Prisma, Vitest).\n` +
  `Respeta la política multi-repo: propone cambios solo en el repo objetivo (task.repo).`;

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
      'Responde con JSON en bloque ```json con la forma:',
      '```json\n{"version":"mcp/analysis@1","summary":"...","risks":["..."],"plan":["..."],"tests":[{"area":"api","notes":"..."}]}\n```'
    ].join('\n\n');
  }

  if (type === 'change.request') {
    return [
      commonHeader,
      'Objetivo: Proponer cambios de código listos para PR.',
      'Responde con JSON en bloque ```json con la forma estricta:',
      '```json\n{"version":"mcp/changeset@1","repo":"REPO","plan":"...","patches":[{"path":"src/file.ts","patch":"--- a/src/file.ts\\n+++ b/src/file.ts\\n@@\\n- old\\n+ new\\n","note":"motivo del cambio"}],"tests":["comando o enfoque"],"notes":"consideraciones"}\n```'
    ].join('\n\n');
  }

  return [commonHeader, 'Objetivo: Resumir y proponer próximos pasos concisos.'].join('\n\n');
}

function tryExtractJson(text) {
  const block = text && String(text).match(/```json\s*([\s\S]*?)```/i);
  if (block) { try { return JSON.parse(block[1]); } catch {} }
  try { return JSON.parse(text); } catch {}
  return null;
}

function pickModelForEnvelope(envelope) {
  switch (envelope.type) {
    case 'task.create': return MS_MODEL_TASK;
    case 'change.request': return MS_MODEL_CHANGE;
    default: return MS_MODEL_SUMMARY;
  }
}

async function callMistral(prompt, model) {
  if (!MS_API_KEY) throw new Error('MISTRAL_API_KEY no configurada');
  if (typeof fetch !== 'function') throw new Error('fetch no disponible (Node < 18)');
  const body = { model: model || MS_MODEL_DEFAULT, messages: [{ role: 'user', content: prompt }] };
  if (MS_TEMPERATURE !== undefined) body.temperature = Number(MS_TEMPERATURE);
  if (MS_TOP_P !== undefined) body.top_p = Number(MS_TOP_P);
  if (MS_MAX_TOKENS !== undefined) body.max_tokens = Number(MS_MAX_TOKENS);
  const res = await fetch(MS_API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'authorization': `Bearer ${MS_API_KEY}` },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch {}
  const content = data?.choices?.[0]?.message?.content || data?.output || text;
  return { status: res.status, content, data, model: model || MS_MODEL_DEFAULT };
}

async function callCodestralFIM(prompt, model, { suffix } = {}) {
  if (!MS_API_KEY) throw new Error('MISTRAL_API_KEY no configurada');
  if (typeof fetch !== 'function') throw new Error('fetch no disponible (Node < 18)');
  const body = { model: model || MS_MODEL_CHANGE, prompt };
  if (suffix) body.suffix = suffix;
  if (MS_TEMPERATURE !== undefined) body.temperature = Number(MS_TEMPERATURE);
  if (MS_TOP_P !== undefined) body.top_p = Number(MS_TOP_P);
  if (MS_MAX_TOKENS !== undefined) body.max_tokens = Number(MS_MAX_TOKENS);
  const res = await fetch(MS_CODESTRAL_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'authorization': `Bearer ${MS_API_KEY}` },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch {}
  // Algunos endpoints devuelven {choices:[{text}]}, otros message.content
  const content = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || data?.output || text;
  return { status: res.status, content, data, model: model || MS_MODEL_CHANGE };
}

async function handle(envelope) {
  const prompt = buildPrompt(envelope);
  try {
    const model = pickModelForEnvelope(envelope);
    let callRes;
    if (envelope.type === 'change.request' && MS_USE_CODESTRAL) {
      // Si vienen prefix/suffix en payload, usar FIM con contexto.
      const px = envelope.payload?.prefix;
      const sx = envelope.payload?.suffix;
      if (px || sx) {
        const fimPrompt = `${px || ''}`;
        try {
          callRes = await callCodestralFIM(fimPrompt, model, { suffix: sx });
        } catch (e) {
          callRes = await callMistral(buildPrompt(envelope), model);
        }
      } else {
        // Intentar FIM con prompt estándar; si falla, fallback a chat
        try {
          callRes = await callCodestralFIM(prompt, model);
        } catch (e) {
          callRes = await callMistral(prompt, model);
        }
      }
    } else {
      callRes = await callMistral(prompt, model);
    }
    const { status, content, model: used } = callRes;
    const json = tryExtractJson(content);
    const result = json ? { provider: 'mistral', model: used, status, structured: json, content } : { provider: 'mistral', model: used, status, content };
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
    writeOut(outEnvelope(envelope, 'log.error', { provider: 'mistral', error: String(e?.message || e) }));
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
