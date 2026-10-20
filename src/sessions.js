const fs = require('node:fs');
const readline = require('node:readline');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mergeRecord(records, line) {
  try {
    const row = JSON.parse(line);
    if (!UUID.test(row.id) || typeof row.thread_name !== 'string') return;
    const time = Date.parse(row.updated_at);
    if (!Number.isFinite(time)) return;
    const previous = records.get(row.id);
    if (!previous || time >= previous.time) {
      records.set(row.id, { id: row.id, title: row.thread_name, time });
    }
  } catch { /* An in-progress JSONL write can have an incomplete last line. */ }
}

async function readSessions(file, limit = 200) {
  const records = new Map();
  const stream = fs.createReadStream(file, { encoding: 'utf8' });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) mergeRecord(records, line);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  } finally {
    lines.close();
    stream.destroy();
  }
  return [...records.values()].sort((a, b) => b.time - a.time).slice(0, limit);
}

function conversationPath(id) {
  if (!UUID.test(id)) throw new Error('Invalid conversation ID.');
  return `/local/${id}`;
}

module.exports = { readSessions, mergeRecord, conversationPath, UUID };
