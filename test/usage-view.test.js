const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderUsage, renderAllowance, UsageView } = require('../src/usage-view');
const { parseLimits } = require('../src/limits');
const now = 1792500000000;
const limits = parseLimits({ rateLimits: {
  limitName: '<img src=x onerror=alert(1)>',
  primary: { usedPercent: 24, windowDurationMins: 10080, resetsAt: now / 1000 + 3600 }
} }, now);

test('combined panel escapes service labels and restricts scripts with a nonce', () => {
  const html = renderUsage({ limits }, 'testnonce', now);
  assert.match(html, /aria-valuenow="76"/);
  assert.match(html, /width:76%/);
  assert.match(html, /role="progressbar"/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img|title=/);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /script-src 'nonce-testnonce'/);
  assert.match(html, /nonce="testnonce"/);
  assert.match(html, /id="sessions"/);
  assert.equal((html.match(/<script/g) || []).length, 1);
});
test('loading, missing allowance and stale data render explicit states without a full bar', () => {
  assert.match(renderUsage({ refreshing: true }, 'n', now), /Loading allowance/);
  assert.match(renderUsage({ error: 'offline' }, 'n', now), /Allowance unavailable/);
  const missing = parseLimits({ rateLimits: { primary: {} } }, now);
  const html = renderAllowance({ limits: missing }, now);
  assert.match(html, /aria-valuetext="Unavailable"/);
  assert.doesNotMatch(html, /aria-valuenow=/);
  assert.match(html, /width:0%/);
  assert.match(renderUsage({ limits, error: 'offline' }, 'n', now), /Last known value/);
  assert.match(renderUsage({ limits }, 'n', now + 3600001), /Last known value/);
});
test('webview sends data updates without replacing its document, resyncs on ready, and detaches', () => {
  let onVisibility, onDispose, onMessage, visibleCalls = 0, disposed = 0;
  const updates = [];
  let state = { refreshing: true };
  const provider = new UsageView(() => state, () => visibleCalls++);
  const view = {
    visible: true, webview: {
      postMessage(message) { updates.push(message); return Promise.resolve(true); },
      onDidReceiveMessage(fn) { onMessage = fn; return { dispose() { disposed++; } }; }
    },
    onDidChangeVisibility(fn) { onVisibility = fn; return { dispose() { disposed++; } }; },
    onDidDispose(fn) { onDispose = fn; }
  };
  provider.resolveWebviewView(view);
  assert.equal(view.webview.options.enableScripts, true);
  assert.deepEqual(view.webview.options.localResourceRoots, []);
  assert.equal(visibleCalls, 1);
  const initialHtml = view.webview.html;
  state = { limits, sessions: [
    { id: 'recent', title: 'Recent' },
    { id: 'favorite', title: 'Favorite', pinned: true }
  ] };
  onMessage({ action: 'ready' });
  provider.update();
  assert.equal(updates.length, 2);
  assert.match(updates[0].allowance, /aria-valuenow="76"/);
  assert.deepEqual(updates[0].sessions.map(row => row.id), ['favorite', 'recent']);
  assert.equal(updates[0].sessions[0].pinned, true);
  assert.equal(view.webview.html, initialHtml);
  view.visible = false; onVisibility();
  assert.equal(provider.visible, false);
  onDispose();
  assert.equal(disposed, 2);
  provider.update();
  assert.equal(updates.length, 2);
});
test('webview only dispatches allowed actions for currently listed conversations', async () => {
  const row = { id: 'saved-session', title: '<script>unsafe title</script>' };
  let state = { sessions: [row] };
  const calls = [];
  const provider = new UsageView(() => state, () => {}, (...args) => calls.push(args));
  await provider.handleAction({ action: 'rename', id: row.id, title: 'forged' });
  await provider.handleAction({ action: 'archive', id: row.id });
  await provider.handleAction({ action: 'refreshLimits' });
  await provider.handleAction({ action: 'executeCommand', id: row.id });
  await provider.handleAction({ action: '__proto__', id: row.id });
  await provider.handleAction({ action: 'archive', id: 'not-in-list' });
  await provider.handleAction(null);
  state = { sessions: [] };
  await provider.handleAction({ action: 'archive', id: row.id });
  assert.deepEqual(calls, [['rename', row], ['archive', row], ['refreshLimits']]);
});
