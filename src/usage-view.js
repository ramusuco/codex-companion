const { randomBytes } = require('node:crypto');
const { describeWindow } = require('./limits');
const { describeTelemetry } = require('./telemetry');
const { readFileSync } = require('node:fs');
const path = require('node:path');

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function renderAllowance({ limits, error, refreshing }, now = Date.now()) {
  const windows = limits?.windows || [];
  const cards = windows.map(window => {
    const display = describeWindow(window, limits.fetchedAt, error, now);
    const remaining = window.remaining;
    const known = typeof remaining === 'number' && Number.isFinite(remaining) && remaining >= 0 && remaining <= 100;
    const reset = window.resetsAt === null ? 'Reset time unavailable'
      : `Resets ${new Date(window.resetsAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}`;
    return `<section class="card">
      <div class="label">${escapeHtml(window.label)}</div>
      <div class="amount">${known ? escapeHtml(remaining) + '<span class="percent">%</span>' : '—'} <span class="remaining">remaining</span></div>
      <div class="meter${display.stale || !known || remaining <= 20 ? ' caution' : ''}"
        role="progressbar" aria-label="${escapeHtml(window.label)} remaining"
        aria-valuemin="0" aria-valuemax="100" ${known ? `aria-valuenow="${remaining}"` : 'aria-valuetext="Unavailable"'}>
        <div class="fill" style="width:${known ? remaining : 0}%"></div>
      </div>
      <div class="reset">${escapeHtml(reset)}</div>
      ${display.stale ? '<div class="notice">Last known value · awaiting refresh</div>' : ''}
    </section>`;
  }).join('');
  const status = refreshing ? 'Updating…' : error ? 'Refresh failed. Use the refresh button to retry.'
    : limits ? `Updated ${new Date(limits.fetchedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · auto-refresh 1 min`
      : 'Use the refresh button to load your allowance.';
  return `${limits?.usageBlocked ? '<div class="notice">Standard usage is currently restricted.</div>' : ''}
    ${cards || `<div class="empty">${refreshing ? 'Loading allowance…' : error ? 'Allowance unavailable.' : 'No allowance data returned.'}</div>`}
    <div class="status" role="status">${escapeHtml(status)}</div>`;
}

function renderUsage(state, nonce, now = Date.now()) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; style-src-attr 'unsafe-inline';">
    <style nonce="${nonce}">
    :root { color-scheme: light dark; }
    html, body { height:100%; }
    body { margin:0; display:flex; flex-direction:column; overflow:hidden; color:var(--vscode-foreground); background:var(--vscode-sideBar-background); font:var(--vscode-font-size,13px) var(--vscode-font-family, sans-serif); }
    .allowance { padding:12px 16px; flex:0 1 auto; max-height:45%; overflow:auto; border-bottom:1px solid var(--vscode-widget-border, #8884); }
    .heading { display:flex; align-items:center; justify-content:space-between; gap:8px; }
    .heading .eyebrow { margin:0; }
    .allowance .heading { margin-bottom:12px; }
    .sessions-heading { padding:12px 16px 6px; flex:none; }
    #sessions { flex:1; min-height:0; overflow:auto; padding:0 6px 8px; }
    button { font:inherit; color:inherit; background:transparent; border:0; cursor:pointer; }
    button:focus-visible { outline:1px solid var(--vscode-focusBorder); outline-offset:-1px; }
    button:hover { background:var(--vscode-toolbar-hoverBackground); }
    .icon-button { padding:3px 6px; border-radius:4px; }
    .session { border-radius:4px; }
    .session.selected { background:var(--vscode-list-inactiveSelectionBackground); }
    .session-main { display:flex; align-items:center; min-width:0; }
    .open { display:flex; align-items:center; gap:7px; min-width:0; flex:1; text-align:left; padding:5px 6px; }
    .title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .context { color:var(--vscode-descriptionForeground); opacity:.8; font-size:11px; white-space:nowrap; flex-shrink:0; }
    .state { width:14px; height:14px; flex-shrink:0; display:inline-flex; align-items:center; justify-content:center; }
    .state.responding { color:var(--vscode-charts-blue); }
    .state.responding::before { content:''; width:10px; height:10px; border:1.5px solid currentColor; border-right-color:transparent; border-radius:50%; animation:spin 1s linear infinite; }
    .state.complete { color:var(--vscode-charts-green); }
    .state.paused, .state.unknown-activity { color:var(--vscode-charts-yellow); }
    .state.unknown { color:var(--vscode-disabledForeground); }
    @keyframes spin { to { transform:rotate(360deg); } }
    @media (prefers-reduced-motion:reduce) { .state.responding::before { animation:none; } }
    .actions, .confirmation { padding:3px 6px 6px 27px; display:flex; flex-wrap:wrap; align-items:center; gap:4px; }
    .actions button, .confirmation button { padding:3px 7px; border-radius:4px; font-size:11px; }
    .confirm { color:var(--vscode-errorForeground); background:color-mix(in srgb, var(--vscode-errorForeground) 15%, transparent); }
    [hidden] { display:none !important; }
    .eyebrow { color:var(--vscode-descriptionForeground); font-size:11px; letter-spacing:.08em; text-transform:uppercase; margin:0 0 12px; }
    .card { padding:0 0 16px; margin:0 0 14px; border-bottom:1px solid var(--vscode-widget-border, #8884); }
    .label { font-weight:600; overflow-wrap:anywhere; }
    .amount { font-size:32px; font-weight:600; line-height:1.2; margin:8px 0 10px; font-variant-numeric:tabular-nums; }
    .percent { font-size:20px; }
    .remaining { font-size:12px; color:var(--vscode-descriptionForeground); font-weight:400; }
    .meter { height:6px; background:var(--vscode-progressBar-background, #007acc); background:color-mix(in srgb, var(--vscode-foreground) 12%, transparent); border-radius:4px; overflow:hidden; }
    .fill { height:100%; background:var(--vscode-charts-green, #2ea043); border-radius:4px; }
    .caution .fill { background:var(--vscode-charts-yellow, #cca700); }
    .reset, .status { margin-top:8px; color:var(--vscode-descriptionForeground); font-size:11px; line-height:1.5; overflow-wrap:anywhere; }
    .notice { margin-top:8px; font-size:11px; color:var(--vscode-editorWarning-foreground, #cca700); }
    .empty { color:var(--vscode-descriptionForeground); line-height:1.5; padding:4px 0; }
    body.vscode-high-contrast .meter, body.vscode-high-contrast-light .meter { outline:1px solid var(--vscode-contrastBorder); }
    </style></head><body>
    <section class="allowance" aria-label="Account allowance">
      <div class="heading"><div class="eyebrow">Account allowance</div><button class="icon-button" data-action="refreshLimits" aria-label="Refresh account allowance">↻</button></div>
      <div id="allowance">${renderAllowance(state, now)}</div>
    </section>
    <div class="heading sessions-heading"><div class="eyebrow">Conversations</div></div>
    <div id="sessions" aria-label="Conversations"></div>
    <div id="empty" class="empty" style="padding:8px 16px" hidden>No saved conversations yet. <button data-action="new">New conversation</button></div>
    <script nonce="${nonce}">${readFileSync(path.join(__dirname, 'panel-client.js'), 'utf8')}</script>
    </body></html>`;
}

const GLOBAL_ACTIONS = new Set(['new', 'refreshLimits']);
const SESSION_ACTIONS = new Set(['open', 'openBeside', 'rename', 'archive']);

class UsageView {
  constructor(getState, onVisible, onAction = () => {}, onError = () => {}) {
    this.getState = getState; this.onVisible = onVisible; this.onAction = onAction; this.onError = onError;
  }
  get visible() { return Boolean(this.view?.visible); }
  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    const messages = view.webview.onDidReceiveMessage(message => {
      if (this.view !== view) return;
      if (message?.action === 'ready') { this.update(); return; }
      this.handleAction(message).catch(this.onError);
    });
    view.webview.html = renderUsage(this.getState(), randomBytes(16).toString('hex'));
    const subscription = view.onDidChangeVisibility(() => {
      if (view.visible) { this.update(); this.onVisible(); }
    });
    view.onDidDispose(() => {
      subscription.dispose();
      messages.dispose();
      if (this.view === view) this.view = undefined;
    });
    if (view.visible) this.onVisible();
  }
  async handleAction(message) {
    if (!message || typeof message.action !== 'string') return;
    if (GLOBAL_ACTIONS.has(message.action)) return this.onAction(message.action);
    if (!SESSION_ACTIONS.has(message.action) || typeof message.id !== 'string') return;
    const row = (this.getState().sessions || []).find(row => row.id === message.id);
    if (row) return this.onAction(message.action, row);
  }
  update() {
    if (!this.view) return;
    const state = this.getState();
    const sessions = (state.sessions || []).map(row => ({
      id: row.id, title: row.title || 'Untitled conversation', ...describeTelemetry(row.telemetry)
    }));
    Promise.resolve(this.view.webview.postMessage({
      type: 'update', allowance: renderAllowance(state), sessions
    })).catch(this.onError);
  }
}

module.exports = { UsageView, renderUsage, renderAllowance };
