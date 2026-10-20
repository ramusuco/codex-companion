const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { readSessions, conversationPath } = require('../src/sessions');

test('append-only index: newest title wins, partial writes ignored, sorted and limited', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-companion-test-'));
  const first = '019d44bd-7f5c-7e21-8ed0-f681a1e03b2c';
  const second = '019d44bd-7f5c-7e21-8ed0-f681a1e03b2d';
  const row = (id, title, day) => JSON.stringify({ id, thread_name: title, updated_at: `2026-10-${day}T00:00:00Z` });
  try {
    const file = path.join(dir, 'index.jsonl');
    await fs.writeFile(file, [
      row(first, '古い名前', '18'), row(second, '別の会話', '19'),
      row(first, '新しい名前', '20'), row(first, '古い行', '17'),
      row('../bad', '無効', '21'), '{"unfinished":'
    ].join('\n'));
    const items = await readSessions(file, 1);
    assert.equal(items.length, 1);
    assert.equal(items[0].title, '新しい名前');
    assert.deepEqual(await readSessions(path.join(dir, 'missing')), []);
    assert.equal(conversationPath(first), `/local/${first}`);
    assert.throws(() => conversationPath('../bad'));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
