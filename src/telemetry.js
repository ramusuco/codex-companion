const fs = require('node:fs/promises');
const path = require('node:path');

const TAIL_BYTES = 1024 * 1024;
const validNumber = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function parseTelemetry(text, truncated = false) {
  const lines = text.split('\n');
  if (truncated) lines.shift();
  // Ignore an unfinished trailing write.
  if (!text.endsWith('\n')) lines.pop();
  const result = { state: 'unknown', stateAt: null, activityAt: null, usage: null };
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.type === 'compacted') { result.usage = null; continue; }
    if (entry.type !== 'event_msg') continue;
    const event = entry.payload;
    if (!event) continue;
    if (Number.isFinite(Date.parse(entry.timestamp))) result.activityAt = entry.timestamp;
    const state = {
      task_started: 'started', task_complete: 'completed',
      turn_aborted: 'interrupted'
    }[event.type];
    if (state) { result.state = state; result.stateAt = entry.timestamp; }
    if (event.type === 'task_started' && result.usage &&
        validNumber(event.model_context_window) && event.model_context_window !== result.usage.limit) {
      result.usage = null;
    }
    if (event.type === 'token_count') {
      const limit = event.info?.model_context_window;
      const used = event.info?.last_token_usage?.total_tokens;
      if (validNumber(limit) && limit > 0 && validNumber(used)) {
        const remaining = Math.max(0, limit - used);
        result.usage = { limit, used, remaining, percent: Math.floor(remaining / limit * 100), at: entry.timestamp };
      }
    }
  }
  return result;
}

class TelemetryReader {
  constructor() { this.cache = new Map(); }
  async read(file, home) {
    if (!file) return { state: 'unknown', usage: null };
    let handle;
    try {
      const [realFile, realHome] = await Promise.all([fs.realpath(file), fs.realpath(home)]);
      const relative = path.relative(realHome, realFile);
      const parts = relative.split(path.sep);
      if (path.isAbsolute(relative) || !['sessions', 'archived_sessions'].includes(parts[0]) ||
          path.extname(realFile) !== '.jsonl') return { state: 'unknown', usage: null };
      const stat = await fs.stat(realFile);
      const key = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
      if (this.cache.get(realFile)?.key === key) return this.cache.get(realFile).value;
      handle = await fs.open(realFile, 'r');
      const start = Math.max(0, stat.size - TAIL_BYTES);
      const buffer = Buffer.alloc(Math.min(stat.size, TAIL_BYTES));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
      const value = parseTelemetry(buffer.subarray(0, bytesRead).toString('utf8'), start > 0);
      if (this.cache.size >= 500) this.cache.delete(this.cache.keys().next().value);
      this.cache.set(realFile, { key, value });
      return value;
    } catch {
      // Missing files, different hosts, and inaccessible logs mean unknown, not idle.
      return { state: 'unknown', usage: null };
    } finally { await handle?.close(); }
  }
}

function describeTelemetry(data = {}, now = Date.now()) {
  const activity = Date.parse(data.activityAt || data.stateAt);
  const recent = Number.isFinite(activity) && now - activity >= 0 && now - activity <= 30000;
  const state = {
    started: recent
      ? ['Responding (estimated)', 'sync~spin', 'charts.blue']
      : ['Activity unknown', 'history', 'charts.yellow'],
    completed: ['Completion recorded', 'pass-filled', 'charts.green'],
    interrupted: ['Interruption recorded', 'debug-pause', 'charts.yellow']
  }[data.state] || ['Status unknown', 'question', 'disabledForeground'];
  const usage = data.usage;
  return {
    description: usage ? `~${usage.percent}% context left` : '',
    stateLabel: state[0],
    icon: state[1],
    color: state[2]
  };
}

module.exports = { parseTelemetry, TelemetryReader, describeTelemetry };
