# Manual de Comandos – Yega MCP (CLI)

Este manual resume los comandos del wrapper `chispart_mcp.sh` y la interfaz de chat para operar el orquestador y agentes usando lenguaje natural (Blackbox).

## Setup rápido

- Copia `.env.example` a `.env` y coloca tus claves:
  - `BLACKBOX_API_KEY` (obligatoria para NL y reportes)
  - `MISTRAL_API_KEY` (opcional; activa agente Codestral/Mistral)
- Inicializa estructuras: `./chispart_mcp.sh init`
- Opcional (limpieza): `bash scripts/chispart-mcp/clean-mailboxes.sh --all .mcp/mailboxes`

## Arranque de agentes

- `./chispart_mcp.sh agents`
  - Levanta `codex` (coordinator) y `gemini` (qa)
  - Si hay `BLACKBOX_API_KEY`, levanta `blackbox` (dev-support)
  - Si hay `MISTRAL_API_KEY`, levanta `mistral` (dev-support con Codestral)

## Comandos base

- `./chispart_mcp.sh task "<título>" <repo>`
- `./chispart_mcp.sh pump` (recolecta y enruta eventos)
- `./chispart_mcp.sh watch` (modo continuo)
- `./chispart_mcp.sh tasks list [--json]`
- `./chispart_mcp.sh tasks show <taskId>`
- `./chispart_mcp.sh tasks close <taskId> [--status done|cancelled]`
- `./chispart_mcp.sh tasks report <taskId>` (interpreta estado con Blackbox)
- `./chispart_mcp.sh tasks plan <taskId>` (deriva pasos desde lastChangeset)

## Cambios y Codestral FIM

- `./chispart_mcp.sh send change "<título>" --repo <repo> --roles analysis,dev-support [--payload '{json}']`
- FIM con contexto de código (Codestral):
  - `./chispart_mcp.sh send change "<título>" --repo <repo> --roles analysis,dev-support --prefix '<código antes>' --suffix '<código después>'`

## Lenguaje natural (Blackbox)

- Crear tarea (NL):
  - `./chispart_mcp.sh nl task "<pedido en lenguaje natural>" --repo <repo> [--roles ...]`
- Interfaz de chat (NL):
- `./chispart_mcp.sh chat new` (crea sesión y abre chat interactivo)
- `./chispart_mcp.sh chat attach <sessionId>` (adjunta a una sesión)
- Al iniciar, el chat arranca silencioso (sin backfill) y con watch activo filtrando eventos relevantes (`task.*`, `result.*`, `change.request`).
- Explicaciones en NL: el chat procesa resultados y devuelve resúmenes en español (no imprime JSON crudo).
 - Resumen de eventos: agrupa las novedades cada ~5s y las resume en una sola línea (puedes cambiar a modo detallado).

### Qué entiende el chat

Pide en lenguaje natural, por ejemplo:

- "crea una tarea para revisar errores 500 en login en Yega-API"
- "enviar un cambio para optimizar pipeline en chispart-cloud-tools"
- "muéstrame la tarea 1234" / "cierra la tarea 1234"
- "reporte de la tarea 1234" / "plan de la tarea 1234"
- "lista tareas" / "pump" / "apaga watch" / "prende watch"

Internamente, el chat usa Blackbox para mapear tu pedido a una intención y ejecuta los comandos del orquestador, guardando la sesión en `.mcp/chats/<sessionId>/log.jsonl`. Mientras `watch` esté encendido, leerá periódicamente `./.mcp/state/timeline.jsonl` y anunciará cambios.

Comandos rápidos dentro del chat:

- `/watch on` | `/watch off` – Enciende/apaga actualizaciones en vivo
- `/watch mode summary` | `/watch mode detailed` – Resumen cada ~5s o línea por evento
- `/filter default` | `/filter all` – Cambia el filtro de eventos del watch
- `/pump` – Recolecta eventos ahora
- `/help` – Muestra ayuda
- `/exit` – Cierra la sesión

## Archivos y estado

- Mailboxes: `./.mcp/mailboxes` (in/out por agente)
- Estado persistente: `./.mcp/state/tasks.json` y `./.mcp/state/timeline.jsonl`
- Chats: `./.mcp/chats/<sessionId>/log.jsonl`
- Logs de agentes: `./.mcp/*.log`

## Consejos

- JSON limpio: los comandos imprimen JSON en stdout y logs en stderr; redirige si necesitas separar (`1> out.json 2> logs.txt`).
- Cuando pruebas proveedores externos, bombea varias veces (`pump`) para recoger todas las respuestas.
- `tasks report` guarda `artifacts.lastSummary`; si hay changeset JSON, `result.review` también queda en `artifacts.lastChangeset`.
