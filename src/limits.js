function windowLabel(minutes, fallback) {
  if (!Number.isFinite(minutes) || minutes <= 0) return fallback;
  if (minutes % 1440 === 0) return `${minutes / 1440}日枠`;
  if (minutes % 60 === 0) return `${minutes / 60}時間枠`;
  return `${minutes}分枠`;
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
        label: `${bucket.limitName || id} · ${windowLabel(window.windowDurationMins, name === 'primary' ? '利用枠1' : '利用枠2')}`,
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
  const amount = window.remaining === null ? '残量不明' : `残り ${window.remaining}%`;
  const reset = window.resetsAt === null ? 'リセット時刻不明' : new Date(window.resetsAt).toLocaleString();
  return {
    description: `${amount}${stale ? '（前回取得）' : ''} · リセット ${reset}`,
    icon: stale || window.remaining === null ? 'warning' : 'dashboard',
    color: stale || window.remaining === null || window.remaining <= 20
      ? 'charts.yellow' : 'charts.green',
    tooltip: [
      'アカウントの利用枠です。会話のコンテキスト残量とは別です。',
      `取得: ${new Date(fetchedAt).toLocaleString()}`,
      `リセット: ${reset}`,
      '残り割合 = 100 − API の使用率。正確な残トークン数は提供されません。',
      expired ? 'リセット予定時刻を過ぎています。新しい取得に成功するまで残量は確定できません。' : '',
      error ? '再取得に失敗しました。表示は前回の値です。' : ''
    ].filter(Boolean).join('\n')
  };
}

module.exports = { parseLimits, describeWindow, windowLabel };
