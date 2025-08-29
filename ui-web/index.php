<?php
// Página principal: lista tareas, timeline y acciones con JS
?>
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MCP UI</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header>
    <h1>MCP – Panel</h1>
    <div class="actions">
      <button id="btn-pump">Pump</button>
      <label><input type="checkbox" id="watch-toggle" checked> Watch</label>
    </div>
  </header>

  <nav class="tabs">
    <button class="tab active" data-tab="tasks-tab">Tareas</button>
    <button class="tab" data-tab="changes-tab">Cambios</button>
    <button class="tab" data-tab="chat-tab">Chat NL</button>
    <button class="tab" data-tab="timeline-tab">Timeline</button>
  </nav>

  <section id="tasks-tab" class="tab-pane active">
    <div class="row">
      <div class="col">
        <h2>Tareas</h2>
        <div class="toolbar">
          <input id="new-title" placeholder="Título de tarea" />
          <input id="new-repo" placeholder="Repo (p.ej. Yega-API)" />
          <button id="btn-create">Crear</button>
        </div>
        <table id="tasks">
          <thead>
            <tr><th>ID</th><th>Repo</th><th>Status</th><th>Título</th><th>Acciones</th></tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
      <div class="col">
        <h2>Detalle</h2>
        <div id="task-detail" class="detail"></div>
        <div class="detail-actions">
          <button id="btn-report" disabled>Reporte</button>
          <button id="btn-plan" disabled>Plan</button>
        </div>
      </div>
    </div>
  </section>

  <section id="changes-tab" class="tab-pane">
    <h2>Solicitar Cambio</h2>
    <div class="form-grid">
      <input id="chg-title" placeholder="Título" />
      <input id="chg-repo" placeholder="Repo (p.ej. Yega-API)" />
      <input id="chg-roles" placeholder="Roles (analysis,dev-support)" />
      <textarea id="chg-payload" placeholder='Payload JSON opcional (p.ej. {"priority":"high"})'></textarea>
      <textarea id="chg-prefix" placeholder="Prefix (FIM opcional)"></textarea>
      <textarea id="chg-suffix" placeholder="Suffix (FIM opcional)"></textarea>
      <button id="btn-send-change">Enviar Cambio</button>
    </div>
    <pre id="chg-result" class="console"></pre>
  </section>

  <section id="chat-tab" class="tab-pane">
    <h2>Chat NL</h2>
    <div class="form-grid">
      <input id="chat-text" placeholder="Pide en lenguaje natural (p.ej. crea una tarea en Yega-API...)" />
      <input id="chat-repo" placeholder="Repo preferido (opcional)" />
      <button id="btn-chat-send">Enviar</button>
    </div>
    <pre id="chat-log" class="console"></pre>
  </section>

  <section id="timeline-tab" class="tab-pane">
    <h2>Timeline</h2>
    <div id="timeline" class="timeline"></div>
  </section>

  <footer>
    <small>Lee estado de ../.mcp/state | PHP + Vanilla JS</small>
  </footer>

  <script src="app.js"></script>
  </body>
</html>
