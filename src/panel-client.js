/* Runs inside the isolated VS Code webview. No external resources. */
(() => {
  const vscode = acquireVsCodeApi();
  const list = document.getElementById('sessions');
  const rows = new Map();
  let selectedId;
  const icons = {
    'sync~spin': ['responding', ''],
    'pass-filled': ['complete', '✓'],
    'debug-pause': ['paused', 'Ⅱ'],
    history: ['unknown-activity', '◷'],
    question: ['unknown', '?']
  };
  function closeActions(except) {
    for (const row of rows.values()) {
      if (row === except) continue;
      row.querySelector('.actions').hidden = true;
      row.querySelector('.confirmation').hidden = true;
      row.querySelector('[data-action="menu"]').setAttribute('aria-expanded', 'false');
    }
  }
  function makeRow(id) {
    const row = document.createElement('div');
    row.className = 'session';
    row.dataset.id = id;
    row.innerHTML = `<div class="session-main">
      <button class="open" data-action="open"><span class="state" aria-hidden="true"></span><span class="title"></span><span class="context"></span></button>
      <button class="icon-button" data-action="menu" aria-label="Conversation actions" aria-expanded="false">⋯</button>
      </div>
      <div class="actions" hidden><button data-action="openBeside">Open to Side</button><button data-action="rename">Rename</button><button data-action="archivePrompt">Archive</button></div>
      <div class="confirmation" hidden><span>Archive?</span><button class="confirm" data-action="archive">Confirm</button><button data-action="cancel">Cancel</button></div>`;
    return row;
  }
  window.addEventListener('message', event => {
    const data = event.data;
    if (data?.type !== 'update') return;
    const allowance = document.getElementById('allowance');
    // Only trusted, escaped HTML produced by the extension host enters this slot.
    if (allowance.innerHTML !== data.allowance) allowance.innerHTML = data.allowance;
    const ids = new Set(data.sessions.map(session => session.id));
    for (const [id, row] of rows) {
      if (!ids.has(id)) { row.remove(); rows.delete(id); }
    }
    data.sessions.forEach((session, index) => {
      let row = rows.get(session.id);
      if (!row) { row = makeRow(session.id); rows.set(session.id, row); }
      row.querySelector('.title').textContent = session.title;
      row.querySelector('.context').textContent = session.description;
      row.querySelector('.open').setAttribute('aria-label',
        `${session.title}, ${session.stateLabel}, ${session.description}`);
      row.querySelector('[data-action="menu"]').setAttribute('aria-label', `Actions for ${session.title}`);
      const [kind, glyph] = icons[session.icon] || icons.question;
      const icon = row.querySelector('.state');
      icon.className = `state ${kind}`;
      icon.textContent = glyph;
      row.classList.toggle('selected', session.id === selectedId);
      if (list.children[index] !== row) list.insertBefore(row, list.children[index] || null);
    });
    document.getElementById('empty').hidden = data.sessions.length !== 0;
  });
  document.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button) { closeActions(); return; }
    const action = button.dataset.action;
    const row = button.closest('.session');
    if (action === 'menu') {
      const menu = row.querySelector('.actions');
      const opening = menu.hidden;
      closeActions();
      menu.hidden = !opening;
      button.setAttribute('aria-expanded', String(opening));
      return;
    }
    if (action === 'archivePrompt') {
      row.querySelector('.actions').hidden = true;
      row.querySelector('.confirmation').hidden = false;
      row.querySelector('[data-action="archive"]').focus();
      return;
    }
    closeActions();
    if (action === 'cancel') { row.querySelector('[data-action="menu"]').focus(); return; }
    if (action === 'open') {
      selectedId = row.dataset.id;
      for (const [id, item] of rows) item.classList.toggle('selected', id === selectedId);
    }
    if (row && action !== 'open') row.querySelector('[data-action="menu"]').focus();
    vscode.postMessage({ action, id: row?.dataset.id });
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      const row = document.activeElement.closest('.session');
      closeActions();
      row?.querySelector('[data-action="menu"]').focus();
    }
  });
  vscode.postMessage({ action: 'ready' });
})();
