UI Web (PHP + JS)

Estructura mínima para visualizar tareas, timeline y ejecutar acciones básicas del MCP.

Requisitos
- PHP 8+ (CLI o servidor embebido)
- Node 18+ disponible en PATH para acciones (pump, crear/cerrar tareas)

Uso local
- Arranca el MCP: `../chispart_mcp.sh init && ../chispart_mcp.sh agents`
- Servir la UI: `php -S 127.0.0.1:8080 -t .`
- Abre: http://127.0.0.1:8080/

Endpoints
- `index.php`: UI
- `api.php?action=tasks` → JSON de tareas
- `api.php?action=timeline&since=<ISO>` → eventos desde `since` (opcional)
- `api.php?action=pump` → ejecuta `orchestrator pump`
- `api.php?action=createTask&title=...&repo=...` → crea tarea
- `api.php?action=closeTask&id=...&status=done|cancelled` → cierra tarea

Notas
- La UI lee estado desde `../.mcp/state/*`.
- Si el host no tiene Node, las acciones devolverán error pero la lectura funcionará.
