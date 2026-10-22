function findConversationTab(groups, route) {
  for (const group of [...groups].sort((a, b) => Number(b.isActive) - Number(a.isActive))) {
    const tab = group.tabs.find(tab => tab.input?.viewType === 'chatgpt.conversationEditor' &&
      tab.input.uri?.scheme === 'openai-codex' && tab.input.uri.authority === 'route' && tab.input.uri.path === route);
    if (tab) return { uri: tab.input.uri, column: group.viewColumn };
  }
}
module.exports = { findConversationTab };
