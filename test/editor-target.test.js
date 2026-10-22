const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findConversationTab } = require('../src/editor-target');
test('existing conversation uses its exact URI and prefers the active group', () => {
  const uri = { scheme: 'openai-codex', authority: 'route', path: '/local/id', query: 'existing=1' };
  const tab = { input: { viewType: 'chatgpt.conversationEditor', uri } };
  const groups = [{viewColumn:1, isActive:false, tabs:[tab]}, {viewColumn:3, isActive:true, tabs:[tab]}];
  assert.deepEqual(findConversationTab(groups, '/local/id'), {uri,column:3});
  assert.equal(findConversationTab(groups, '/local/other'), undefined);
  assert.equal(groups[0].viewColumn, 1);
  assert.equal(findConversationTab([{tabs:[{input:{uri}}]}], '/local/id'), undefined);
});
