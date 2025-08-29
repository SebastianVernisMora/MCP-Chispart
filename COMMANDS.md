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

## Flujos comunes

- Arranque rápido:
  - `./chispart_mcp.sh init`
  - `./chispart_mcp.sh agents` (levanta adaptadores y, si hay keys, blackbox/mistral)
  - `./chispart_mcp.sh task "<título>" <repo>` y luego `./chispart_mcp.sh pump` o `watch`
- Cierre de ciclo:
  - `./chispart_mcp.sh tasks list --json` para inspeccionar
  - `./chispart_mcp.sh tasks show <taskId>` para ver el detalle
  - `./chispart_mcp.sh tasks close <taskId> --status done` para cerrar
- Cambios asistidos:
  - `./chispart_mcp.sh send change "<título>" --repo <repo> --roles analysis,dev-support`
  - Con FIM: agrega `--prefix` y/o `--suffix`
- NL + chat:
  - `./chispart_mcp.sh nl task "<pedido NL>" --repo <repo>`
  - `./chispart_mcp.sh chat new` y usa `/pump`, `/watch on`, `/filter all`

## Ejemplos

- Crear tarea y enrutar eventos:
  - `./chispart_mcp.sh task "Investigar error 500 en login" Yega-API`
  - `./chispart_mcp.sh pump`
- Ver tareas y detalle:
  - `./chispart_mcp.sh tasks list --json`
  - `./chispart_mcp.sh tasks show 123e4567-e89b-12d3-a456-426614174000`
- Solicitar cambio con contexto FIM (Codestral):
  - `./chispart_mcp.sh send change "Refactor handler de login" --repo Yega-API --roles analysis,dev-support \
    --prefix 'export async function login(req, res) {\n  // validar input\n' \
    --suffix '\n  // TODO: logs métricas\n}'`
- Reporte y plan desde changeset:
  - `./chispart_mcp.sh tasks report <taskId>`
  - `./chispart_mcp.sh tasks plan <taskId>`
- Limpieza de buzones:
  - `bash scripts/chispart-mcp/clean-mailboxes.sh .mcp/mailboxes`
  - `bash scripts/chispart-mcp/clean-mailboxes.sh --all .mcp/mailboxes`

## Solución de problemas

- Node < 18: `fetch no disponible` → usa Node 18+.
- Falta `BLACKBOX_API_KEY`: NL/chat y `tasks report` fallan → define la key en `.env`.
- Falta `MISTRAL_API_KEY`: el agente `mistral` no inicia → es opcional; define la key si quieres FIM nativo.
- Permisos/paths: asegúrate de ejecutar desde la raíz del proyecto (`MCP-Chispart`) y que `./.mcp` sea escribible.
- Sin eventos al hacer `pump`: verifica que los agentes estén corriendo (`./chispart_mcp.sh agents`) y que haya archivos en `./.mcp/mailboxes/*.out`.

## Variables de entorno clave

- Blackbox: `BLACKBOX_API_URL`, `BLACKBOX_API_KEY`, `BLACKBOX_MODEL*`, `BLACKBOX_TEMPERATURE`, `BLACKBOX_MAX_TOKENS`.
- Mistral/Codestral: `MISTRAL_API_URL`, `MISTRAL_CODESTRAL_URL`, `MISTRAL_API_KEY`, `MISTRAL_MODEL*`, `MISTRAL_USE_CODESTRAL`.
- MCP: `MCP_POLL_MS`, `MCP_STATE_ROOT`, `MCP_MAILBOX_ROOT`, `MCP_AGENT_NAME`, `MCP_AGENT_ROLE`.

## Seguridad

- No subas `.env` al repositorio (ya está ignorado en `.gitignore`).
- Usa `.env.example` con placeholders, no keys reales.
- Evita imprimir keys en consola/logs.
