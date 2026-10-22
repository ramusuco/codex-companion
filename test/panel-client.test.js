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
    value: '', select() {}, addEventListener(type, fn) { this[type] = fn; }, setAttribute() {}, focus() { this.focused = true; },
    querySelector(selector) { return this.parts[selector]; },
    parts: {}
  });
  nodes.sessions = element();
  nodes.sessions.insertBefore = row => nodes.sessions.children.push(row);
  nodes.allowance = element();
  nodes.empty = element();
  nodes.search = element();
  nodes['no-matches'] = element();
  const document = {
    getElementById: id => nodes[id],
    addEventListener: (type, fn) => { events[type] = fn; },
    createElement() {
      const row = element();
      for (const selector of ['.actions', '.confirmation', '.title', '.context', '.open', '.state', '.pin', '[data-action="togglePin"]',
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
  return { events, sent, update, row, click, nodes, document };
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


test('inline search handles normalization, refresh, Enter and Escape', () => {
 const {nodes, document, row, update, events, sent} = setup();
 document.activeElement = nodes.search;
 nodes.search.value = '\uFF29\uFF2D\uFF27'; nodes.search.input();
 assert.equal(row.hidden, false);
 events.keydown({key:'Enter'});
 assert.deepEqual(sent.at(-1), {action:'open',id:'one'});
 nodes.search.value='missing'; nodes.search.input(); update();
 assert.equal(row.hidden,true);
 assert.equal(nodes['no-matches'].hidden,false);
 events.keydown({key:'Escape'});
 assert.equal(row.hidden,false);
 assert.equal(nodes.search.value,'');
});

test('pin action targets its conversation', () => {
 const {click, sent} = setup();
 click('togglePin');
 assert.deepEqual(sent.at(-1), {action:'togglePin',id:'one'});
});
