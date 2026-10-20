const { randomBytes } = require('node:crypto');
const { describeWindow } = require('./limits');

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function renderUsage({ limits, error, refreshing }, nonce, now = Date.now()) {
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
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; style-src-attr 'unsafe-inline';">
    <style nonce="${nonce}">
    :root { color-scheme: light dark; }
    body { margin:0; padding:12px 16px; color:var(--vscode-foreground); background:var(--vscode-sideBar-background); font:var(--vscode-font-size,13px) var(--vscode-font-family, sans-serif); }
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
    <div class="eyebrow">Account allowance</div>
    ${limits?.usageBlocked ? '<div class="notice">Standard usage is currently restricted.</div>' : ''}
    ${cards || `<div class="empty">${refreshing ? 'Loading allowance…' : error ? 'Allowance unavailable.' : 'No allowance data returned.'}</div>`}
    <div class="status" role="status">${escapeHtml(status)}</div>
    </body></html>`;
}

class UsageView {
  constructor(getState, onVisible) { this.getState = getState; this.onVisible = onVisible; }
  get visible() { return Boolean(this.view?.visible); }
  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: false, localResourceRoots: [] };
    this.update();
    const subscription = view.onDidChangeVisibility(() => {
      if (view.visible) { this.update(); this.onVisible(); }
    });
    view.onDidDispose(() => {
      subscription.dispose();
      if (this.view === view) this.view = undefined;
    });
    if (view.visible) this.onVisible();
  }
  update() {
    if (this.view) this.view.webview.html = renderUsage(this.getState(), randomBytes(16).toString('hex'));
  }
}

module.exports = { UsageView, renderUsage };
