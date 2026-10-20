const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseLimits, describeWindow } = require('../src/limits');

const now = 1792500000000;
const bucket = {
  primary: { usedPercent: 24, windowDurationMins: 10080, resetsAt: now / 1000 + 1000 },
  secondary: { usedPercent: 80, windowDurationMins: 300, resetsAt: now / 1000 + 2000 }
};
test('account limits preserve actual windows, subtract usage, and do not duplicate the default bucket', () => {
  const result = parseLimits({ rateLimits: bucket, rateLimitsByLimitId: { codex: bucket, other: {
    limitName: 'Other', primary: { usedPercent: 50, windowDurationMins: 60 }
  } } }, now);
  assert.equal(result.windows.length, 3);
  assert.equal(result.windows[0].remaining, 76);
  assert.match(result.windows[0].label, /7-day limit/);
  assert.match(result.windows[1].label, /5-hour limit/);
  assert.match(result.windows[2].label, /Other/);
  assert.equal(result.windows[2].resetsAt, null);
  assert.equal(result.windows[0].resetsAt, now + 1000000);
});
test('missing limits are not unlimited; malformed values remain unknown', () => {
  assert.deepEqual(parseLimits({}).windows, []);
  assert.equal(parseLimits({ rateLimitsByLimitId: { codex: null }, rateLimits: bucket }).windows.length, 2);
  for (const value of [undefined, null, '24', -1, 101, Infinity]) {
    const result = parseLimits({ rateLimits: { primary: { usedPercent: value, resetsAt: 'soon' } } }, now);
    assert.equal(result.windows[0].remaining, null);
    assert.equal(result.windows[0].resetsAt, null);
    assert.match(describeWindow(result.windows[0], now, null, now).description, /Allowance unknown/);
  }
  assert.equal(parseLimits({ ordinaryUsageAllowed: false }).usageBlocked, true);
});
test('failed refresh, stale snapshot and elapsed reset never silently become full allowance', () => {
  const { windows } = parseLimits({ rateLimits: bucket }, now);
  assert.doesNotMatch(describeWindow(windows[0], now, null, now).description, /last known/);
  assert.match(describeWindow(windows[0], now, 'offline', now).description, /76% remaining \(last known\)/);
  assert.match(describeWindow(windows[0], now, null, now + 180000).description, /last known/);
  const reset = describeWindow(windows[0], now + 1000000, null, now + 1000001);
  assert.match(reset.description, /76% remaining \(last known\)/);
  assert.match(reset.tooltip, /reset time has passed/);
});
