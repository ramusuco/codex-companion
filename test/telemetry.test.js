const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { parseTelemetry, TelemetryReader, describeTelemetry } = require('../src/telemetry');

const event = (payload, timestamp = '2026-10-21T00:00:00Z') =>
  JSON.stringify({ type: 'event_msg', timestamp, payload }) + '\n';
const token = (used, limit) => event({ type: 'token_count', info: {
  total_token_usage: { total_tokens: 99999999 },
  last_token_usage: { total_tokens: used }, model_context_window: limit
} });

test('uses last usage, not accumulated billing tokens; state labels never claim live status', () => {
  const value = parseTelemetry(event({ type: 'task_started' }) + token(40, 100));
  assert.equal(value.usage.percent, 60);
  assert.equal(value.state, 'started');
  assert.match(describeTelemetry(value, Date.parse('2026-10-21T01:00:00Z')).description, /実行状況不明/);
  assert.doesNotMatch(describeTelemetry(value).description, /実行中/);
  assert.equal(parseTelemetry(event({ type: 'task_complete' })).state, 'completed');
  assert.equal(parseTelemetry(event({ type: 'turn_aborted' })).state, 'interrupted');
});
test('recent log activity uses a blue estimated spinner, becomes unknown without updates', () => {
  const now = Date.parse('2026-10-21T00:00:20Z');
  const value = parseTelemetry(event({ type: 'task_started' }) + token(40, 100));
  assert.equal(describeTelemetry(value, now).icon, 'sync~spin');
  assert.equal(describeTelemetry(value, now).color, 'charts.blue');
  assert.match(describeTelemetry(value, now).description, /推定/);
  assert.equal(describeTelemetry(value, now + 20000).icon, 'history');
  assert.equal(describeTelemetry(value, now - 40000).icon, 'history');
  const completed = parseTelemetry(event({ type: 'task_started' }) + event({ type: 'task_complete' }));
  assert.equal(describeTelemetry(completed, now).color, 'charts.green');
  assert.equal(describeTelemetry(completed, now).icon, 'pass-filled');
  assert.equal(describeTelemetry(parseTelemetry(''), now).color, 'disabledForeground');
});
test('missing, malformed, partial and invalid metrics never become 100% or idle', () => {
  assert.equal(parseTelemetry('').usage, null);
  for (const used of [null, -1, '5']) assert.equal(parseTelemetry(token(used, 100)).usage, null);
  assert.equal(parseTelemetry(token(5, 0)).usage, null);
  assert.equal(parseTelemetry(token(200, 100)).usage.percent, 0);
  assert.equal(parseTelemetry(event({ type: 'task_complete' }).trim()).state, 'unknown');
  assert.equal(parseTelemetry('partial\n' + token(30, 100), true).usage.percent, 70);
  assert.equal(parseTelemetry('broken\n').state, 'unknown');
  assert.equal(parseTelemetry(token(30, 100) + '{"type":"compacted"}\n').usage, null);
  assert.equal(parseTelemetry(token(30, 100) + event({ type: 'task_started', model_context_window: 200 })).usage, null);
});
test('bounded local tail reader caches, refreshes appended records, and rejects outside-home files', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'companion-metrics-'));
  try {
    await fs.mkdir(path.join(home, 'sessions'));
    const file = path.join(home, 'sessions', 'test.jsonl');
    await fs.writeFile(file, 'x'.repeat(1024 * 1024 + 20) + '\n' + token(20, 100));
    const reader = new TelemetryReader();
    const first = await reader.read(file, home);
    assert.equal(first.usage.percent, 80);
    assert.equal(await reader.read(file, home), first);
    await fs.appendFile(file, token(50, 100));
    assert.equal((await reader.read(file, home)).usage.percent, 50);
    const other = path.join(home, 'other.jsonl');
    await fs.writeFile(other, token(10, 100));
    assert.equal((await reader.read(other, home)).state, 'unknown');
    assert.equal((await reader.read(path.join(home, 'sessions', 'missing'), home)).usage, null);
  } finally {
    assert.equal(path.dirname(home), os.tmpdir());
    assert.ok(path.basename(home).startsWith('companion-metrics-'));
    await fs.rm(home, { recursive: true, force: true });
  }
});
