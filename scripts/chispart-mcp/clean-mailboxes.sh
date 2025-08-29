#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 [--all] [MAILBOX_ROOT]" >&2
  echo "  --all           Limpia también inbox (*.in). Por defecto solo *.out" >&2
}

ALL=false
ROOT="${1:-}"

if [[ "${1:-}" == "--all" ]]; then
  ALL=true
  shift || true
fi

if [[ -z "${1:-}" ]]; then
  ROOT=".mcp/mailboxes"
else
  ROOT="$1"
fi

if [[ ! -d "$ROOT" ]]; then
  echo "Mailbox root no existe: $ROOT" >&2
  exit 1
fi

echo "Limpieza de mailboxes en: $ROOT" >&2

# Limpia outboxes (siempre)
OUT_COUNT=$(find "$ROOT" -type f -name "*.json" -path "*/.out/*" -printf '.' 2>/dev/null | wc -c || true)
if [[ "$OUT_COUNT" -gt 0 ]]; then
  find "$ROOT" -type f -name "*.json" -path "*/.out/*" -print -delete
else
  echo "No hay archivos en *.out" >&2
fi

# Limpia inbox si --all
if $ALL; then
  IN_COUNT=$(find "$ROOT" -type f -name "*.json" -path "*/.in/*" -printf '.' 2>/dev/null | wc -c || true)
  if [[ "$IN_COUNT" -gt 0 ]]; then
    find "$ROOT" -type f -name "*.json" -path "*/.in/*" -print -delete
  else
    echo "No hay archivos en *.in" >&2
  fi
fi

# Purga archivos .json de tamaño 0 en todo el árbol
ZERO_COUNT=$(find "$ROOT" -type f -name "*.json" -size 0 -printf '.' 2>/dev/null | wc -c || true)
if [[ "$ZERO_COUNT" -gt 0 ]]; then
  echo "Eliminando archivos .json de 0 bytes: $ZERO_COUNT" >&2
  find "$ROOT" -type f -name "*.json" -size 0 -print -delete
fi

echo "Listo." >&2

