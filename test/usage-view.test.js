const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderUsage, UsageView } = require('../src/usage-view');
const { parseLimits } = require('../src/limits');
const now = 1792500000000;
const limits = parseLimits({ rateLimits: {
  limitName: '<img src=x onerror=alert(1)>',
  primary: { usedPercent: 24, windowDurationMins: 10080, resetsAt: now / 1000 + 3600 }
} }, now);

test('usage cards escape service labels and include an accessible remaining-allowance bar without scripts', () => {
  const html = renderUsage({ limits }, 'testnonce', now);
  assert.match(html, /aria-valuenow="76"/);
  assert.match(html, /width:76%/);
  assert.match(html, /role="progressbar"/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img|<script|title=/);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /nonce="testnonce"/);
});
test('loading, missing allowance and stale data render explicit states without a full bar', () => {
  assert.match(renderUsage({ refreshing: true }, 'n', now), /Loading allowance/);
  assert.match(renderUsage({ error: 'offline' }, 'n', now), /Allowance unavailable/);
  const missing = parseLimits({ rateLimits: { primary: {} } }, now);
  const html = renderUsage({ limits: missing }, 'n', now);
  assert.match(html, /aria-valuetext="Unavailable"/);
  assert.doesNotMatch(html, /aria-valuenow=/);
  assert.match(html, /width:0%/);
  assert.match(renderUsage({ limits, error: 'offline' }, 'n', now), /Last known value/);
  assert.match(renderUsage({ limits }, 'n', now + 3600001), /Last known value/);
});
test('webview receives updates, uses no scripts, and detaches on dispose', () => {
  let onVisibility, onDispose, visibleCalls = 0, disposed = false;
  let state = { refreshing: true };
  const provider = new UsageView(() => state, () => visibleCalls++);
  const view = {
    visible: true, webview: {},
    onDidChangeVisibility(fn) { onVisibility = fn; return { dispose() { disposed = true; } }; },
    onDidDispose(fn) { onDispose = fn; }
  };
  provider.resolveWebviewView(view);
  assert.equal(view.webview.options.enableScripts, false);
  assert.equal(visibleCalls, 1);
  state = { limits };
  provider.update();
  assert.match(view.webview.html, /aria-valuenow="76"/);
  view.visible = false; onVisibility();
  assert.equal(provider.visible, false);
  onDispose();
  assert.equal(disposed, true);
  provider.update();
});
