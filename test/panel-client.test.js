const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const script = fs.readFileSync(path.join(__dirname, '../src/panel-client.js'), 'utf8');

function setup() {
  const events = {}, sent = [], nodes = {};
  const element = () => ({
    hidden: false, dataset: {}, children: [], classList: { toggle() {} },
    setAttribute() {}, focus() { this.focused = true; },
    querySelector(selector) { return this.parts[selector]; },
    parts: {}
  });
  nodes.sessions = element();
  nodes.sessions.insertBefore = row => nodes.sessions.children.push(row);
  nodes.allowance = element();
  nodes.empty = element();
  const document = {
    getElementById: id => nodes[id],
    addEventListener: (type, fn) => { events[type] = fn; },
    createElement() {
      const row = element();
      for (const selector of ['.actions', '.confirmation', '.title', '.context', '.open', '.state',
        '[data-action="menu"]', '[data-action="archive"]']) row.parts[selector] = element();
      row.parts['.actions'].hidden = true;
      row.parts['.confirmation'].hidden = true;
      row.closest = () => row;
      return row;
    }
  };
  vm.runInNewContext(script, {
    acquireVsCodeApi: () => ({ postMessage: value => sent.push(JSON.parse(JSON.stringify(value))) }),
    document, window: { addEventListener: (type, fn) => { events[type] = fn; } }
  });
  const update = () => events.message({ data: { type: 'update', allowance: '<p>Allowance</p>',
    sessions: [{ id: 'one', title: '<img src=x>', description: '~62% context left',
      stateLabel: 'Responding (estimated)', icon: 'sync~spin' }] } });
  update();
  const row = nodes.sessions.children[0];
  const click = action => events.click({ target: { closest: () => ({
    dataset: { action }, closest: () => row, setAttribute() {}
  }) } });
  document.activeElement = row;
  return { events, sent, update, row, click };
}

test('archive requires an inline confirm; cancellation and Escape never dispatch archive', () => {
  const { row, click, sent, events } = setup();
  click('menu');
  click('archivePrompt');
  assert.equal(row.parts['.confirmation'].hidden, false);
  assert.equal(row.parts['[data-action="archive"]'].focused, true);
  assert.deepEqual(sent, [{ action: 'ready' }]);
  click('cancel');
  assert.equal(row.parts['.confirmation'].hidden, true);
  click('archivePrompt');
  events.keydown({ key: 'Escape' });
  assert.equal(row.parts['.confirmation'].hidden, true);
  assert.equal(sent.length, 1);
  click('archivePrompt');
  click('archive');
  assert.deepEqual(sent[1], { action: 'archive', id: 'one' });
  assert.equal(row.parts['.confirmation'].hidden, true);
});

test('refresh preserves row and pending confirmation; titles are assigned as text', () => {
  const { row, click, update } = setup();
  click('archivePrompt');
  update();
  assert.equal(row.parts['.confirmation'].hidden, false);
  assert.equal(row.parts['.title'].textContent, '<img src=x>');
  assert.equal(row.parts['.state'].className, 'state responding');
  assert.equal(row.parts['.context'].textContent, '~62% context left');
});
