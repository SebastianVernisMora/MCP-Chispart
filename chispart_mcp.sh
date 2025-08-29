#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")" && pwd)
MAILBOX="${ROOT_DIR}/.mcp/mailboxes"

# Auto-cargar variables desde .env si existe
if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ROOT_DIR/.env"
  set +a
fi

cmd_init() {
  node "$ROOT_DIR/scripts/chispart-mcp/orchestrator.mjs" init
}

cmd_agents() {
  # Minimal test agents (no external providers)
  MCP_MAILBOX_ROOT="$MAILBOX" MCP_AGENT_NAME=codex MCP_AGENT_ROLE=coordinator \
    node "$ROOT_DIR/scripts/chispart-mcp/agents/adapter-template.mjs" &
  MCP_MAILBOX_ROOT="$MAILBOX" MCP_AGENT_NAME=gemini MCP_AGENT_ROLE=qa \
    node "$ROOT_DIR/scripts/chispart-mcp/agents/adapter-template.mjs" &
  # Opcional: Blackbox (si hay API Key)
  if [[ -n "${BLACKBOX_API_KEY:-}" ]]; then
    MCP_MAILBOX_ROOT="$MAILBOX" MCP_AGENT_NAME=blackbox MCP_AGENT_ROLE=dev-support \
      node "$ROOT_DIR/scripts/chispart-mcp/agents/blackbox.mjs" &
    echo "Blackbox agent started."
  else
    echo "BLACKBOX_API_KEY no definida; omitiendo blackbox."
  fi
  # Opcional: Mistral (si hay API Key)
  if [[ -n "${MISTRAL_API_KEY:-}" ]]; then
    MCP_MAILBOX_ROOT="$MAILBOX" MCP_AGENT_NAME=mistral MCP_AGENT_ROLE=dev-support \
      node "$ROOT_DIR/scripts/chispart-mcp/agents/mistral.mjs" &
    echo "Mistral agent started."
  else
    echo "MISTRAL_API_KEY no definida; omitiendo mistral."
  fi
  echo "Test agents started (codex, gemini)."
}

cmd_task() {
  local title="$1"; shift
  # Limit target roles in tests to active adapters only
  node "$ROOT_DIR/scripts/chispart-mcp/orchestrator.mjs" task "$title" --repo "${1:-Yega-API}" --roles coordinator,qa
}

cmd_pump() {
  node "$ROOT_DIR/scripts/chispart-mcp/orchestrator.mjs" pump
}

cmd_watch() {
  node "$ROOT_DIR/scripts/chispart-mcp/orchestrator.mjs" watch
}

cmd_tasks() {
  local sub="${1:-}"; shift || true
  case "$sub" in
    list)
      node "$ROOT_DIR/scripts/chispart-mcp/orchestrator.mjs" tasks list "$@" ;;
    show)
      node "$ROOT_DIR/scripts/chispart-mcp/orchestrator.mjs" tasks show "$@" ;;
    report)
      node "$ROOT_DIR/scripts/chispart-mcp/orchestrator.mjs" tasks report "$@" ;;
    plan)
      node "$ROOT_DIR/scripts/chispart-mcp/orchestrator.mjs" tasks plan "$@" ;;
    close)
      node "$ROOT_DIR/scripts/chispart-mcp/orchestrator.mjs" tasks close "$@" ;;
    *)
      echo "Usage: $0 tasks {list|show <taskId>|report <taskId>|plan <taskId>|close <taskId> [--status done|cancelled]}" ;;
  esac
}

cmd_send() {
  local sub="${1:-}"; shift || true
  case "$sub" in
    change)
      node "$ROOT_DIR/scripts/chispart-mcp/orchestrator.mjs" send change "$@" ;;
    *)
      echo "Usage: $0 send change \"<title>\" --repo <repo> [--roles r1,r2] [--agents a1,a2] [--task <taskId>] [--payload '{json}'] [--prefix '<code>'] [--suffix '<code>']" ;;
  esac
}

cmd_nl() {
  local sub="${1:-}"; shift || true
  case "$sub" in
    task)
      node "$ROOT_DIR/scripts/chispart-mcp/orchestrator.mjs" nl task "$@" ;;
    exec)
      node "$ROOT_DIR/scripts/chispart-mcp/orchestrator.mjs" nl exec "$@" ;;
    *)
      echo "Usage: $0 nl {task|exec} \"<pedido NL>\" [--repo <repo>] [--roles r1,r2] [--agents a1,a2]" ;;
  esac
}

cmd_chat() {
  local sub="${1:-new}"; shift || true
  case "$sub" in
    new)
      node "$ROOT_DIR/scripts/chispart-mcp/chat.mjs" new ;;
    attach)
      node "$ROOT_DIR/scripts/chispart-mcp/chat.mjs" attach "$@" ;;
    *)
      echo "Usage: $0 chat {new|attach <sessionId>}" ;;
  esac
}

case "${1:-}" in
  init) cmd_init ;;
  agents) cmd_agents ;;
  task) shift; cmd_task "$@" ;;
  pump) cmd_pump ;;
  watch) cmd_watch ;;
  tasks) shift; cmd_tasks "$@" ;;
  send) shift; cmd_send "$@" ;;
  nl) shift; cmd_nl "$@" ;;
  chat) shift; cmd_chat "$@" ;;
  clean)
    shift || true
    bash "$ROOT_DIR/scripts/chispart-mcp/clean-mailboxes.sh" "$@" ;;
  *)
    echo "Usage: $0 {init|agents|task <title> [repo]|pump|watch|tasks <subcmd>|send <subcmd>|nl <subcmd>|chat {new|attach}|clean [--all] [root]}" ;;
esac
