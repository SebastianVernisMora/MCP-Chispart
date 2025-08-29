#!/usr/bin/env node
// Qwen adapter (MVP): integra vía CLI OAuth
// No asume binario/flags exactos; configurable por env vars.

import { readdirSync, readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';

const AGENT_NAME = process.env.MCP_AGENT_NAME || 'qwen';
const ROLE = process.env.MCP_AGENT_ROLE || 'analysis';
const ROOT = process.env.MCP_MAILBOX_ROOT || '.mcp/mailboxes';
const INBOX = join(ROOT, `${AGENT_NAME}.in`);
const OUTBOX = join(ROOT, `${AGENT_NAME}.out`);

// Config CLI
const QWEN_CLI_CMD = process.env.QWEN_CLI_CMD || 'qwen';
const QWEN_CLI_ARGS = (process.env.QWEN_CLI_ARGS || '').split(' ').filter(Boolean); // e.g. "chat -m Qwen2.5-72B-Instruct"

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

function promptFromEnvelope(envelope) {
  const { type, task, payload } = envelope;
  const repo = task?.repo || 'global';
  const title = task?.title || '';
  const desc = task?.description || '';
  const intent = `Evento=${type}, Repo=${repo}`;
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload || {}, null, 2);
  return [
    `Ayuda con análisis/plan de cambios para el ecosistema Yega.`,
    intent,
    `Tarea: ${title}`,
    desc ? `Descripción: ${desc}` : '',
    input ? `Contexto/Payload:\n${input}` : ''
  ].filter(Boolean).join('\n\n');
}

function runQwenCLI(prompt) {
  return new Promise((resolve) => {
    const cp = spawn(QWEN_CLI_CMD, QWEN_CLI_ARGS, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    cp.stdout.on('data', d => out += d.toString());
    cp.stderr.on('data', d => err += d.toString());
    cp.on('error', e => {
      // Captura error de spawn (binario ausente, permisos, etc.)
      resolve({ code: -1, stdout: out.trim(), stderr: `spawn error: ${e?.message || e}` });
    });
    cp.on('close', code => {
      resolve({ code, stdout: out.trim(), stderr: err.trim() });
    });
    try { cp.stdin.write(prompt); cp.stdin.end(); } catch {}
  });
}

async function handle(envelope) {
  const prompt = promptFromEnvelope(envelope);
  const res = await runQwenCLI(prompt);
  if (res.code === 0) {
    const content = res.stdout;
    switch (envelope.type) {
      case 'task.create':
        writeOut(outEnvelope(envelope, 'result.review', { provider: 'qwen-cli', content, kind: 'analysis' }));
        break;
      case 'change.request':
        writeOut(outEnvelope(envelope, 'result.review', { provider: 'qwen-cli', content, kind: 'change-plan' }));
        break;
      default:
        writeOut(outEnvelope(envelope, 'log.info', { message: 'processed', provider: 'qwen-cli' }));
    }
  } else {
    writeOut(outEnvelope(envelope, 'log.error', { provider: 'qwen-cli', code: res.code, stderr: res.stderr }));
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
