const { spawn } = require('node:child_process');
const readline = require('node:readline');

// Each short-lived connection performs metadata operations only; never starts a turn.
async function withServer(executable, home, action) {
  const child = spawn(executable, ['app-server'], {
    env: { ...process.env, CODEX_HOME: home },
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
  });
  const pending = new Map();
  let nextId = 0;
  let failure;
  const fail = error => {
    failure = error;
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    pending.clear();
  };
  child.on('error', fail);
  child.on('exit', () => fail(new Error('Codex 管理プロセスが終了しました。')));
  child.stdin.on('error', fail);
  child.stderr.resume();
  const lines = readline.createInterface({ input: child.stdout });
  const send = message => child.stdin.write(JSON.stringify(message) + '\n');
  lines.on('line', line => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.method) {
      if (message.id !== undefined) send({ id: message.id, error: { code: -32601, message: 'Unsupported client request' } });
      return;
    }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    if (failure) { reject(failure); return; }
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Codex ${method} がタイムアウトしました。一覧を更新して状態を確認してください。`));
    }, 20000);
    pending.set(id, { resolve, reject, timer });
    send({ id, method, params });
  });
  try {
    await request('initialize', { clientInfo: { name: 'codex_companion', version: require('../package.json').version } });
    send({ method: 'initialized', params: {} });
    return await action(request);
  } finally {
    lines.close();
    child.stdin.end();
    child.kill();
    fail(new Error('Connection closed'));
  }
}

async function listSessions(request, limit, archived = false) {
  const rows = [];
  let cursor = null;
  do {
    const result = await request('thread/list', {
      limit: Math.min(100, limit - rows.length), cursor,
      archived, sortKey: 'updated_at', sourceKinds: [], modelProviders: []
    });
    rows.push(...result.data.map(row => ({
      id: row.id, title: row.name || row.preview || '無題の会話',
      time: row.updatedAt * 1000, rolloutPath: row.path
    })));
    cursor = result.nextCursor;
  } while (cursor && rows.length < limit);
  return rows;
}
module.exports = { withServer, listSessions };
