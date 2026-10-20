function windowLabel(minutes, fallback) {
  if (!Number.isFinite(minutes) || minutes <= 0) return fallback;
  if (minutes % 1440 === 0) return `${minutes / 1440}-day limit`;
  if (minutes % 60 === 0) return `${minutes / 60}-hour limit`;
  return `${minutes}-minute limit`;
}

function parseLimits(response, now = Date.now()) {
  const entries = response?.rateLimitsByLimitId && typeof response.rateLimitsByLimitId === 'object'
    ? Object.entries(response.rateLimitsByLimitId).filter(([, value]) => value && typeof value === 'object')
    : [];
  if (!entries.length && response?.rateLimits) entries.push([response.rateLimits.limitId || 'codex', response.rateLimits]);
  const windows = [];
  for (const [id, bucket] of entries) {
    for (const name of ['primary', 'secondary']) {
      const window = bucket[name];
      if (!window) continue;
      const used = window.usedPercent;
      // Missing, invalid, or out-of-range usage is unknown, never "100% remaining".
      const remaining = typeof used === 'number' && Number.isFinite(used) && used >= 0 && used <= 100
        ? Math.floor((100 - used) * 10) / 10 : null;
      const reset = window.resetsAt;
      windows.push({
        id: `${id}:${name}`,
        label: `${bucket.limitName || id} · ${windowLabel(window.windowDurationMins, name === 'primary' ? 'Primary limit' : 'Secondary limit')}`,
        remaining,
        resetsAt: typeof reset === 'number' && Number.isFinite(reset) && reset > 0 &&
          Number.isFinite(new Date(reset * 1000).getTime()) ? reset * 1000 : null
      });
    }
  }
  return { windows, fetchedAt: now, usageBlocked: response?.ordinaryUsageAllowed === false };
}

function describeWindow(window, fetchedAt, error, now = Date.now()) {
  const expired = window.resetsAt !== null && window.resetsAt <= now;
  const stale = Boolean(error) || expired || now - fetchedAt > 120000;
  const amount = window.remaining === null ? 'Allowance unknown' : `${window.remaining}% remaining`;
  const reset = window.resetsAt === null ? 'Unknown' : new Date(window.resetsAt).toLocaleString('en-US');
  return {
    stale,
    description: `${amount}${stale ? ' (last known)' : ''} · Resets ${reset}`,
    icon: stale || window.remaining === null ? 'warning' : 'dashboard',
    color: stale || window.remaining === null || window.remaining <= 20
      ? 'charts.yellow' : 'charts.green',
    tooltip: [
      'Account allowance, separate from conversation context.',
      `Updated: ${new Date(fetchedAt).toLocaleString('en-US')}`,
      `Resets: ${reset}`,
      'Remaining percentage = 100 minus API usage. Exact remaining tokens are not available.',
      expired ? 'The expected reset time has passed. Refresh to retrieve the new allowance.' : '',
      error ? 'Refresh failed. Showing the last known value.' : ''
    ].filter(Boolean).join('\n')
  };
}

module.exports = { parseLimits, describeWindow, windowLabel };
