const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { withServer, listSessions } = require('../src/backend');

test('real isolated app-server: rename, archive, list, unarchive', {
  skip: !process.env.CODEX_COMPANION_TEST_BINARY,
  timeout: 60000
}, async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-companion-api-'));
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  const day = timestamp.slice(0, 10);
  const dir = path.join(home, 'sessions', ...day.split('-'));
  try {
    await fs.mkdir(dir, { recursive: true });
    const records = [
      { timestamp, type: 'session_meta', payload: {
        id, timestamp, cwd: home, originator: 'codex_cli_rs', cli_version: '0.1.0',
        source: 'cli', model_provider: 'openai'
      } },
      { timestamp, type: 'event_msg', payload: { type: 'user_message', message: 'codex-companion test fixture', images: [] } }
    ];
    await fs.writeFile(path.join(dir, `rollout-${day}T00-00-00-${id}.jsonl`), records.map(JSON.stringify).join('\n') + '\n');
    await withServer(process.env.CODEX_COMPANION_TEST_BINARY, home, async request => {
      let rows = await listSessions(request, 10);
      assert.ok(rows.some(row => row.id === id), 'fixture discovered');
      await request('thread/name/set', { threadId: id, name: '名前変更の検証' });
      rows = await listSessions(request, 10);
      assert.equal(rows.find(row => row.id === id)?.title, '名前変更の検証');
      await request('thread/archive', { threadId: id });
      assert.ok(!(await listSessions(request, 10)).some(row => row.id === id));
      assert.ok((await listSessions(request, 10, true)).some(row => row.id === id));
      await request('thread/unarchive', { threadId: id });
      assert.equal((await listSessions(request, 10)).find(row => row.id === id)?.title, '名前変更の検証');
      await assert.rejects(request('thread/name/set', { threadId: randomUUID(), name: 'missing' }));
    });
  } finally {
    // mkdtemp supplies the absolute isolated target; never remove a configured Codex home.
    assert.equal(path.dirname(home), os.tmpdir());
    assert.ok(path.basename(home).startsWith('codex-companion-api-'));
    await fs.rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
