(() => {
  const tasksTable = document.querySelector('#tasks tbody');
  const timelineDiv = document.querySelector('#timeline');
  const btnPump = document.querySelector('#btn-pump');
  const btnCreate = document.querySelector('#btn-create');
  const inpTitle = document.querySelector('#new-title');
  const inpRepo = document.querySelector('#new-repo');
  const watchToggle = document.querySelector('#watch-toggle');
  const detailEl = document.querySelector('#task-detail');
  const btnReport = document.querySelector('#btn-report');
  const btnPlan = document.querySelector('#btn-plan');

  // Changes
  const chgTitle = document.querySelector('#chg-title');
  const chgRepo = document.querySelector('#chg-repo');
  const chgRoles = document.querySelector('#chg-roles');
  const chgPayload = document.querySelector('#chg-payload');
  const chgPrefix = document.querySelector('#chg-prefix');
  const chgSuffix = document.querySelector('#chg-suffix');
  const btnSendChange = document.querySelector('#btn-send-change');
  const chgResult = document.querySelector('#chg-result');

  // Chat NL
  const chatText = document.querySelector('#chat-text');
  const chatRepo = document.querySelector('#chat-repo');
  const btnChatSend = document.querySelector('#btn-chat-send');
  const chatLog = document.querySelector('#chat-log');

  let lastTs = new Date().toISOString();

  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  function toast(msg, ms = 3000) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  function renderTasks(data) {
    const tasks = Array.isArray(data?.tasks) ? data.tasks : (Array.isArray(data) ? data : []);
    tasksTable.innerHTML = '';
    for (const t of tasks) {
      const tr = document.createElement('tr');
      const id = t.id || '';
      tr.innerHTML = `
        <td title="${id}">${id.slice(0, 8)}…</td>
        <td>${t.repo || ''}</td>
        <td>${t.status || ''}</td>
        <td>${t.title || ''}</td>
        <td>
          <button data-act="show" data-id="${id}">Ver</button>
          <button data-act="close" data-id="${id}">Cerrar</button>
        </td>
      `;
      tasksTable.appendChild(tr);
    }
  }

  function renderDetail(t) {
    if (!t) { detailEl.textContent = ''; btnReport.disabled = true; btnPlan.disabled = true; return; }
    btnReport.disabled = !t?.id;
    btnPlan.disabled = !(t?.artifacts?.lastChangeset);
    const parts = [];
    parts.push(`ID: ${t.id}`);
    parts.push(`Repo: ${t.repo}`);
    parts.push(`Status: ${t.status}`);
    parts.push(`Title: ${t.title}`);
    if (t.artifacts?.lastSummary) parts.push(`\nLast Summary: ${JSON.stringify(t.artifacts.lastSummary.structured || {}, null, 2)}`);
    if (t.artifacts?.lastChangeset) parts.push(`\nHas Changeset: yes`);
    if (Array.isArray(t.updates)) {
      parts.push('\nUpdates:');
      for (const u of t.updates.slice(-10)) parts.push(`- [${u.at}] ${u.from}: ${u.type}`);
    }
    detailEl.textContent = parts.join('\n');
    detailEl.dataset.taskId = t.id;
  }

  function appendTimeline(events) {
    if (!Array.isArray(events) || !events.length) return;
    for (const e of events) {
      const div = document.createElement('div');
      const type = e?.envelope?.type || e?.event || '';
      const from = e?.from || e?.envelope?.agent?.name || 'orchestrator';
      const taskId = e?.envelope?.task?.id || '';
      div.textContent = `[${e.ts}] ${type} from=${from}${taskId ? ' task=' + taskId.slice(0,8)+'…' : ''}`;
      timelineDiv.prepend(div);
      lastTs = e.ts;
    }
  }

  async function refreshAll() {
    try { renderTasks(await fetchJson('api.php?action=tasks')); } catch {}
    try { appendTimeline(await fetchJson('api.php?action=timeline')); } catch {}
  }

  async function poll() {
    if (!watchToggle.checked) return;
    try { const ev = await fetchJson('api.php?action=timeline&since=' + encodeURIComponent(lastTs)); appendTimeline(ev); } catch {}
  }

  btnPump.addEventListener('click', async () => {
    btnPump.disabled = true; btnPump.textContent = 'Pumping…';
    try { const r = await fetchJson('api.php?action=pump'); if (!r.ok) toast('Pump error'); await refreshAll(); } catch (e) { toast('Pump error'); }
    finally { btnPump.disabled = false; btnPump.textContent = 'Pump'; }
  });

  btnCreate.addEventListener('click', async () => {
    const title = inpTitle.value.trim(); const repo = inpRepo.value.trim();
    if (!title || !repo) { alert('Completa título y repo'); return; }
    btnCreate.disabled = true; btnCreate.textContent = 'Creando…';
    try { const r = await fetchJson('api.php?action=createTask&title=' + encodeURIComponent(title) + '&repo=' + encodeURIComponent(repo)); if (!r.ok) toast('Error creando tarea'); await refreshAll(); }
    catch (e) { toast('Error: ' + e); }
    finally { btnCreate.disabled = false; btnCreate.textContent = 'Crear'; }
  });

  tasksTable.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-act]'); if (!btn) return;
    const act = btn.getAttribute('data-act'); const id = btn.getAttribute('data-id');
    if (act === 'show') {
      btn.disabled = true;
      try {
        const r = await fetchJson('api.php?action=taskShow&id=' + encodeURIComponent(id));
        renderDetail(r.task);
        // auto-switch to tasks tab if needed
        switchTab('tasks-tab');
      } catch (e) { toast('Error cargando detalle'); }
      finally { btn.disabled = false; }
    } else if (act === 'close') {
      if (!confirm('Cerrar tarea?')) return;
      btn.disabled = true; btn.textContent = 'Cerrando…';
      try { const r = await fetchJson('api.php?action=closeTask&id=' + encodeURIComponent(id) + '&status=done'); if (!r.ok) toast('Error cerrando tarea'); await refreshAll(); }
      catch (e) { toast('Error: ' + e); }
      finally { btn.disabled = false; btn.textContent = 'Cerrar'; }
    }
  });

  btnReport.addEventListener('click', async () => {
    const id = detailEl.dataset.taskId; if (!id) return;
    btnReport.disabled = true; try { await fetchJson('api.php?action=tasksReport&id=' + encodeURIComponent(id)); await refreshAll(); const r = await fetchJson('api.php?action=taskShow&id=' + encodeURIComponent(id)); renderDetail(r.task); } catch (e) { toast('Error reporte'); } finally { btnReport.disabled = false; }
  });
  btnPlan.addEventListener('click', async () => {
    const id = detailEl.dataset.taskId; if (!id) return;
    btnPlan.disabled = true; try { const r = await fetchJson('api.php?action=tasksPlan&id=' + encodeURIComponent(id)); toast('Plan generado'); await refreshAll(); } catch (e) { toast('Error plan'); } finally { btnPlan.disabled = false; }
  });

  // Init
  refreshAll();
  setInterval(poll, 2000);

  // Changes form
  btnSendChange.addEventListener('click', async () => {
    const params = new URLSearchParams();
    if (chgTitle.value) params.append('title', chgTitle.value);
    if (chgRepo.value) params.append('repo', chgRepo.value);
    if (chgRoles.value) params.append('roles', chgRoles.value);
    if (chgPayload.value) params.append('payload', chgPayload.value);
    if (chgPrefix.value) params.append('prefix', chgPrefix.value);
    if (chgSuffix.value) params.append('suffix', chgSuffix.value);
    btnSendChange.disabled = true; btnSendChange.textContent = 'Enviando…';
    try { const r = await fetchJson('api.php?action=sendChange&' + params.toString()); chgResult.textContent = JSON.stringify(r, null, 2); toast('Cambio enviado'); }
    catch (e) { chgResult.textContent = String(e); toast('Error enviando cambio'); }
    finally { btnSendChange.disabled = false; btnSendChange.textContent = 'Enviar Cambio'; }
  });

  // Tabs
  function switchTab(id) {
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === id));
  }
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  // Chat NL
  btnChatSend.addEventListener('click', async () => {
    const text = chatText.value.trim(); if (!text) return;
    const params = new URLSearchParams(); params.append('text', text); if (chatRepo.value) params.append('repo', chatRepo.value);
    btnChatSend.disabled = true; btnChatSend.textContent = 'Enviando…';
    try { const r = await fetchJson('api.php?action=nlExec&' + params.toString()); chatLog.textContent = JSON.stringify(r, null, 2) + '\n\n' + chatLog.textContent; await refreshAll(); }
    catch (e) { toast('Error chat NL'); }
    finally { btnChatSend.disabled = false; btnChatSend.textContent = 'Enviar'; chatText.value=''; }
  });
})();
