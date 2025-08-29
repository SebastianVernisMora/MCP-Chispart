#!/usr/bin/env node
// Adapter genérico de agente (MVP)
import { readdirSync, readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const AGENT_NAME = process.env.MCP_AGENT_NAME || 'codex';
const ROLE = process.env.MCP_AGENT_ROLE || 'coordinator';
const ROOT = process.env.MCP_MAILBOX_ROOT || '.mcp/mailboxes';
const INBOX = join(ROOT, `${AGENT_NAME}.in`);
const OUTBOX = join(ROOT, `${AGENT_NAME}.out`);

function ensure() {
  if (!existsSync(INBOX)) mkdirSync(INBOX, { recursive: true });
  if (!existsSync(OUTBOX)) mkdirSync(OUTBOX, { recursive: true });
}

function nowISO() { return new Date().toISOString(); }

function ack(envelope, payload, typeOverride) {
  const out = {
    id: envelope.id,
    type: typeOverride || `${envelope.type}.ack`,
    agent: { name: AGENT_NAME, role: ROLE },
    target: envelope.target,
    task: envelope.task,
    payload,
    meta: { ...envelope.meta, timestamp: nowISO() }
  };
  const file = join(OUTBOX, `${out.id}-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2));
}

function handle(envelope) {
  // Ignora eventos que pueden causar bucles o ruido
  const t = envelope?.type || '';
  if (t.endsWith('.ack') || t.startsWith('log.') || t.startsWith('result.')) {
    return; // evitar tormenta de ACKs y eco de logs/resultados
  }
  // Lógica mínima de ejemplo por tipo
  switch (envelope.type) {
    case 'task.create': {
      const info = { status: 'in_progress', note: `${AGENT_NAME} tomó la tarea` };
      ack(envelope, info, 'task.update');
      break;
    }
    case 'change.request': {
      ack(envelope, { accepted: true });
      break;
    }
    default: {
      // Por defecto, reconocer solo eventos operativos no ruidosos
      ack(envelope, { seen: true });
    }
  }
}

function loopOnce() {
  const files = existsSync(INBOX) ? readdirSync(INBOX) : [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const full = join(INBOX, f);
    try {
      const env = JSON.parse(readFileSync(full, 'utf-8'));
      handle(env);
    } catch {}
    try { rmSync(full); } catch {}
  }
}

function main() {
  ensure();
  const interval = Number(process.env.MCP_POLL_MS || '1000');
  console.log(`[${AGENT_NAME}] adapter running; inbox=${INBOX}, outbox=${OUTBOX}`);
  loopOnce();
  setInterval(loopOnce, interval);
}

main();
