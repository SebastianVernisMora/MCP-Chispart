# MCP Agents & Orchestrator – Estado y Uso

Este documento resume la arquitectura basada en mailboxes, los cambios implementados para persistir tareas, y cómo operar los agentes y el orquestador.

## Resumen de arquitectura

- Bus de archivos (mailboxes) en `./.mcp/mailboxes`: cada agente tiene `name.in/` y `name.out/`.
- Orquestador: `scripts/chispart-mcp/orchestrator.mjs` crea tareas, enruta eventos y ahora registra estado persistente.
- Agentes de ejemplo:
  - Adaptador genérico: `scripts/chispart-mcp/agents/adapter-template.mjs`
  - Qwen (CLI): `scripts/chispart-mcp/agents/qwen.mjs`
  - Blackbox (HTTP API): `scripts/chispart-mcp/agents/blackbox.mjs`
  - Mistral (API nativa): `scripts/chispart-mcp/agents/mistral.mjs`
- Config: `scripts/chispart-mcp/config/agents.json`

## Novedades (persistencia)

- Estado persistente en `./.mcp/state` (configurable):
  - `tasks.json`: lista de tareas y su historial de actualizaciones.
  - `timeline.jsonl`: un registro `JSONL` con todos los eventos salientes de agentes y creaciones de tareas.
- Nuevos comandos del orquestador:
  - `tasks list [--json]`: lista tareas persistidas.
  - `tasks show <taskId>`: muestra el detalle (incluye `updates`).
- Registro automático:
  - En `task` (creación) se inserta la tarea en `tasks.json` y se añade a `timeline.jsonl`.
  - En `pump` y `watch` se agregan todos los eventos salientes de los agentes a la línea de tiempo y se actualizan las tareas (status/updates) cuando corresponde.
  - Cuando llegan `result.review` de proveedores (p.ej. Blackbox), se anexan a `updates` y además se guardan artefactos en `task.artifacts.lastReview`. Si el resultado incluye un changeset estructurado (`version: mcp/changeset@1`), se guarda como `task.artifacts.lastChangeset`.

## Directorios y archivos

- Mailboxes (configurable): `scripts/chispart-mcp/config/agents.json:mailboxesRoot` → por defecto `./.mcp/mailboxes`
- Estado (nuevo): `scripts/chispart-mcp/config/agents.json:stateRoot` → por defecto `./.mcp/state`
- Limpieza: `scripts/chispart-mcp/clean-mailboxes.sh` (con `--all` también limpia inbox)

## Variables de entorno relevantes

- Orquestador/Estado:
  - `MCP_STATE_ROOT`: ruta alternativa para `state` (opcional). Si no se define, usa `stateRoot` del config.
- Agentes (genéricos):
  - `MCP_MAILBOX_ROOT`: raíz de mailboxes; por defecto `./.mcp/mailboxes`.
  - `MCP_AGENT_NAME`: nombre del agente (e.g., `codex`, `gemini`).
  - `MCP_AGENT_ROLE`: rol del agente (e.g., `coordinator`, `qa`).
  - `MCP_POLL_MS`: intervalo de lectura de inbox.
- Qwen CLI:
  - `QWEN_CLI_CMD` (por defecto `qwen`), `QWEN_CLI_ARGS` (e.g., `chat -m Qwen2.5-72B-Instruct`).
- Blackbox API:
  - `BLACKBOX_API_URL`, `BLACKBOX_API_KEY` (requerida para llamadas), `BLACKBOX_MODEL*`, `BLACKBOX_TEMPERATURE`, `BLACKBOX_TOP_P`, `BLACKBOX_MAX_TOKENS`.
  - La CLI del orquestador usa Blackbox para comandos NL (`nl task`) y para `tasks report` (resúmenes interpretados).
- Mistral API:
  - `MISTRAL_API_URL`, `MISTRAL_API_KEY`, `MISTRAL_MODEL*`, `MISTRAL_TEMPERATURE`, `MISTRAL_TOP_P`, `MISTRAL_MAX_TOKENS`.
  - Si defines `MISTRAL_API_KEY`, el wrapper levanta el agente nativo `mistral`.

## Uso recomendado

1) Inicializar mailboxes y estado

```sh
./chispart_mcp.sh init
```

2) Levantar agentes de ejemplo (coordinator y qa con el adaptador genérico)

```sh
./chispart_mcp.sh agents
# Si tienes BLACKBOX_API_KEY y/o MISTRAL_API_KEY en tu entorno, también se inician esos agentes.
```

3) Crear una tarea (target repo por argumento)

```sh
./chispart_mcp.sh task "Investigar error de login" Yega-API
```

4) Recolectar y enrutar eventos (modo bomba o watch)

```sh
./chispart_mcp.sh pump
# o modo continuo
node scripts/chispart-mcp/orchestrator.mjs watch
```

5) Consultar tareas persistidas

```sh
./chispart_mcp.sh tasks list
./chispart_mcp.sh tasks list --json
./chispart_mcp.sh tasks show <taskId>

6) Cerrar una tarea (estado final)

```sh
./chispart_mcp.sh tasks close <taskId> [--status done|cancelled]
```
```

Notas:
- El wrapper `chispart_mcp.sh` expone `tasks list/show/close`.
- Los adaptadores borran los archivos de inbox una vez procesados (comportamiento intencional para evitar reprocesamiento).

## Modelo de datos de `tasks.json`

Ejemplo de estructura:

```json
{
  "tasks": [
    {
      "id": "<uuid>",
      "title": "Investigar error de login",
      "description": "",
      "repo": "Yega-API",
      "status": "in_progress",
      "createdAt": "2025-01-01T00:00:00.000Z",
      "updatedAt": "2025-01-01T00:05:00.000Z",
      "updates": [
        { "at": "...", "from": "orchestrator", "type": "task.create", "payload": {} },
        { "at": "...", "from": "codex", "type": "task.update", "payload": { "status": "in_progress" } }
      ]
      ,
      "artifacts": {
        "lastReview": {
          "from": "blackbox",
          "at": "...",
          "kind": "changeset",
          "provider": "blackbox",
          "model": "...",
          "status": 200,
          "structured": { "version": "mcp/changeset@1", "patches": [/* ... */] },
          "summary": "primeros 400 chars del contenido"
        },
        "lastChangeset": { "version": "mcp/changeset@1", "patches": [/* ... */] }
      }
    }
  ]
}
```

`timeline.jsonl` contiene una línea por evento con `{ ts, event, from?, envelope }` para auditoría.

## Mantenimiento y limpieza

- Limpiar outboxes: `scripts/chispart-mcp/clean-mailboxes.sh`
- Limpiar también inbox: `scripts/chispart-mcp/clean-mailboxes.sh --all`
- No elimina estado persistente (`.mcp/state`); si necesitas resetearlo, bórralo manualmente.

## Próximos pasos sugeridos

- Opcional: endpoint HTTP ligero para consultar estado y timeline.
7) Solicitar un cambio (change request)

```sh
./chispart_mcp.sh send change "Actualizar validaciones de login" --repo Yega-API --roles analysis,dev-support \
  --payload '{"context":"detectar doble submit","priority":"high"}'

# O asociar a una tarea existente:
./chispart_mcp.sh send change "Refactor módulo de pagos" --repo Yega-API --roles analysis,dev-support \
  --task <taskId>

# Opcional: usar Codestral FIM con contexto de archivo
./chispart_mcp.sh send change "Refactor función X con contexto" --repo chispart-cloud-tools --roles analysis,dev-support \
  --prefix 'function doWork(input) {\n  // TODO: refactor\n' \
  --suffix '\n  return result;\n}'
```
8) Crear tarea en lenguaje natural (Blackbox)

```sh
./chispart_mcp.sh nl task "Investigar bug de login: clientes no pueden iniciar sesión al primer intento" --repo Yega-API --roles coordinator,qa
```

9) Reporte interpretado de una tarea (Blackbox)

```sh
./chispart_mcp.sh tasks report <taskId>
# Guarda resumen en artifacts.lastSummary y lo imprime (JSON con version mcp/result-summary@1)

10) Plan de aplicación (pull plan) desde un changeset

./chispart_mcp.sh tasks plan <taskId>
# Deriva pasos aplicables desde artifacts.lastChangeset y los guarda en artifacts.pullPlan
```
