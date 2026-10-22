const vscode = require('vscode');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { readSessions, conversationPath, UUID } = require('./sessions');
const { withServer, listSessions } = require('./backend');
const fs = require('node:fs');
const { TelemetryReader, describeTelemetry } = require('./telemetry');
const { parseLimits } = require('./limits');
const { UsageView } = require('./usage-view');

function activate(context) {
  let sessions = [];
  let refreshing;
  let restoring = false;
  let saveTimer;
  let watcher;
  let managing = false;
  let telemetryUpdating = false;
  let telemetryDisposed = false;
  const telemetryReader = new TelemetryReader();
  let limits;
  let limitsError;
  let limitsRefreshing;
  let limitsAttemptedAt = 0;
  const usageView = new UsageView(
    () => ({ limits, error: limitsError, refreshing: Boolean(limitsRefreshing), sessions }),
    () => {
      updateTelemetry().catch(report);
      if (Date.now() - limitsAttemptedAt >= 60000) refreshLimits().catch(report);
    },
    (action, row) => commands[action](row),
    error => report(error)
  );
  const config = () => vscode.workspace.getConfiguration('codexCompanion');
  const home = () => config().get('codexHome') || process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const output = vscode.window.createOutputChannel('codex-companion');
  function backend(action) {
    const extension = vscode.extensions.getExtension('openai.chatgpt');
    if (!extension) throw new Error('The official Codex extension is required.');
    if (process.platform === 'win32' && vscode.workspace.getConfiguration('chatgpt').get('runCodexInWindowsSubsystemForLinux')) {
      throw new Error('Manage WSL conversations from a VS Code window connected to WSL.');
    }
    const platform = { win32: 'windows', darwin: 'macos', linux: 'linux' }[process.platform];
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
    const binary = path.join(extension.extensionPath, 'bin', `${platform}-${arch}`, process.platform === 'win32' ? 'codex.exe' : 'codex');
    if (!fs.existsSync(binary)) throw new Error('The Codex executable could not be found in the official extension.');
    return withServer(binary, home(), action);
  }
  const report = (error) => {
    output.appendLine(String(error?.stack || error));
    vscode.window.showErrorMessage(`codex-companion: ${error.message || error}`);
  };
  async function refreshLimits() {
    if (limitsRefreshing) return limitsRefreshing;
    limitsAttemptedAt = Date.now();
    const selectedHome = home();
    limitsRefreshing = (async () => {
      try {
        const result = await backend(request => request('account/rateLimits/read', {}));
        if (telemetryDisposed || home() !== selectedHome) return;
        limits = parseLimits(result);
        limitsError = undefined;
      } catch (error) {
        if (telemetryDisposed || home() !== selectedHome) return;
        limitsError = error.message;
        output.appendLine(`Failed to fetch account allowance: ${error.message}`);
      }
    })();
    usageView.update();
    try { await limitsRefreshing; } finally {
      limitsRefreshing = undefined;
      if (!telemetryDisposed) usageView.update();
    }
  }
  async function updateTelemetry() {
    if (telemetryUpdating || telemetryDisposed) return;
    telemetryUpdating = true;
    const snapshot = sessions;
    let index = 0;
    try {
      await Promise.all(Array.from({ length: 4 }, async () => {
        while (index < snapshot.length && !telemetryDisposed) {
          const row = snapshot[index++];
          row.telemetry = await telemetryReader.read(row.rolloutPath, home());
        }
      }));
      if (!telemetryDisposed) usageView.update();
    } finally { telemetryUpdating = false; }
  }
  async function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        sessions = await backend(request => listSessions(request, config().get('maxSessions', 200)));
      } catch (error) {
        output.appendLine(`Session API unavailable; using the local index: ${error.message}`);
        sessions = await readSessions(path.join(home(), 'session_index.jsonl'), config().get('maxSessions', 200));
      }
      await updateTelemetry();
      usageView.update();
    })();
    try { await refreshing; } finally { refreshing = undefined; }
  }
  async function openRoute(route, column, query = '') {
    const extension = vscode.extensions.getExtension('openai.chatgpt');
    if (!extension) throw new Error('The official Codex extension (openai.chatgpt) is required.');
    await extension.activate();
    const uri = vscode.Uri.from({ scheme: 'openai-codex', authority: 'route', path: route, query });
    await vscode.commands.executeCommand('vscode.openWith', uri, 'chatgpt.conversationEditor', {
      viewColumn: column ?? vscode.window.tabGroups.activeTabGroup.viewColumn,
      preview: false, preserveFocus: false
    });
  }
  async function openSession(row, column) {
    if (!row) return search();
    await openRoute(conversationPath(row.id), column);
    scheduleSave();
  }
  async function search() {
    await refresh();
    const selected = await vscode.window.showQuickPick(sessions.map(row => ({
      label: row.title || 'Untitled conversation',
      description: describeTelemetry(row.telemetry).description, row
    })), { placeHolder: 'Search saved Codex conversations', matchOnDescription: true });
    if (selected) await openSession(selected.row);
  }
  async function manage(action) {
    if (managing) return;
    managing = true;
    try { await action(); } finally { managing = false; }
  }
  async function rename(row) {
    if (!row) return;
    conversationPath(row.id);
    const name = await vscode.window.showInputBox({
      title: 'Rename Codex Conversation', value: row.title,
      validateInput: value => value.trim() ? undefined : 'Enter a name.'
    });
    if (name === undefined || name.trim() === row.title) return;
    await backend(request => request('thread/name/set', { threadId: row.id, name: name.trim() }));
    if (refreshing) await refreshing;
    await refresh();
    vscode.window.showInformationMessage('Conversation renamed. Reopen any existing Codex tab to update its title.');
  }
  async function archive(row) {
    if (!row) return;
    conversationPath(row.id);
    await backend(request => request('thread/archive', { threadId: row.id }));
    await context.workspaceState.update('openSessions',
      context.workspaceState.get('openSessions', []).filter(item => item.id !== row.id));
    const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab =>
      tab.input?.uri?.scheme === 'openai-codex' && tab.input.uri.path === conversationPath(row.id));
    if (tabs.length) await vscode.window.tabGroups.close(tabs);
    if (refreshing) await refreshing;
    await refresh();
  }
  async function unarchive() {
    const archived = await backend(request => listSessions(request, config().get('maxSessions', 200), true));
    if (!archived.length) { vscode.window.showInformationMessage('No archived conversations.'); return; }
    const selected = await vscode.window.showQuickPick(archived.map(row => ({ label: row.title, row })),
      { placeHolder: 'Choose an archived conversation to restore' });
    if (!selected) return;
    conversationPath(selected.row.id);
    await backend(request => request('thread/unarchive', { threadId: selected.row.id }));
    if (refreshing) await refreshing;
    await refresh();
  }
  function capture() {
    const rows = [];
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const uri = tab.input?.uri;
        if (uri?.scheme !== 'openai-codex' || uri.authority !== 'route') continue;
        const id = uri.path.match(/^\/local\/([^/]+)$/)?.[1];
        if (id && UUID.test(id)) rows.push({ id, column: group.viewColumn });
      }
    }
    return rows;
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (restoring) return;
      const rows = capture();
      // Keep the last nonempty snapshot when VS Code closes all tabs on shutdown.
      if (rows.length) context.workspaceState.update('openSessions', rows).then(undefined, report);
    }, 800);
  }
  async function restore() {
    const saved = context.workspaceState.get('openSessions', []);
    if (!saved.length) {
      vscode.window.showInformationMessage('No saved conversation tabs to restore.');
      return;
    }
    restoring = true;
    try {
      for (const row of saved) await openSession(row, row.column);
    } finally {
      restoring = false;
      scheduleSave();
    }
  }
  function watch() {
    watcher?.dispose();
    watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(home(), 'session_index.jsonl'));
    const update = () => refresh().catch(report);
    watcher.onDidChange(update);
    watcher.onDidCreate(update);
    watcher.onDidDelete(update);
  }
  const commands = {
    new: () => openRoute('/extension/panel/new', undefined, `codexCompanion=${randomUUID()}`),
    open: row => openSession(row, vscode.ViewColumn.Beside),
    openBeside: row => openSession(row, vscode.ViewColumn.Beside),
    search, refresh: () => Promise.all([refresh(), refreshLimits()]), restore, refreshLimits,
    rename: row => manage(() => rename(row)),
    archive: row => manage(() => archive(row)),
    unarchive: () => manage(unarchive)
  };
  for (const [name, handler] of Object.entries(commands)) {
    context.subscriptions.push(vscode.commands.registerCommand(`codexCompanion.${name}`,
      (...args) => Promise.resolve().then(() => handler(...args)).catch(report)));
  }
  const telemetryTimer = setInterval(() => {
    if (usageView.visible && !refreshing) updateTelemetry().catch(error => output.appendLine(String(error)));
    if (usageView.visible && Date.now() - limitsAttemptedAt >= 60000) refreshLimits().catch(report);
  }, 10000);
  context.subscriptions.push(
    output,
    vscode.window.registerWebviewViewProvider('codexCompanion.sessions', usageView),
    vscode.window.tabGroups.onDidChangeTabs(scheduleSave),
    vscode.window.tabGroups.onDidChangeTabGroups(scheduleSave),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('codexCompanion')) {
        watch(); refresh().catch(report);
        limits = undefined; limitsError = undefined; limitsAttemptedAt = 0;
        refreshLimits().catch(report);
      }
    }),
    { dispose() { telemetryDisposed = true; clearInterval(telemetryTimer); clearTimeout(saveTimer); watcher?.dispose(); } }
  );
  watch();
  refresh().catch(report);
  refreshLimits().catch(report);
}

module.exports = { activate };
