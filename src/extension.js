const vscode = require('vscode');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { readSessions, conversationPath, UUID } = require('./sessions');
const { withServer, listSessions } = require('./backend');
const fs = require('node:fs');
const { TelemetryReader, describeTelemetry } = require('./telemetry');
const { parseLimits, describeWindow } = require('./limits');

function activate(context) {
  const changed = new vscode.EventEmitter();
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
  const limitsNode = { kind: 'limits' };
  const config = () => vscode.workspace.getConfiguration('codexCompanion');
  const home = () => config().get('codexHome') || process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const output = vscode.window.createOutputChannel('codex-companion');
  function backend(action) {
    const extension = vscode.extensions.getExtension('openai.chatgpt');
    if (!extension) throw new Error('公式 Codex 拡張が必要です。');
    if (process.platform === 'win32' && vscode.workspace.getConfiguration('chatgpt').get('runCodexInWindowsSubsystemForLinux')) {
      throw new Error('WSL の会話管理は WSL 側の VS Code ウィンドウで実行してください。');
    }
    const platform = { win32: 'windows', darwin: 'macos', linux: 'linux' }[process.platform];
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
    const binary = path.join(extension.extensionPath, 'bin', `${platform}-${arch}`, process.platform === 'win32' ? 'codex.exe' : 'codex');
    if (!fs.existsSync(binary)) throw new Error('公式拡張の Codex 実行ファイルが見つかりません。');
    return withServer(binary, home(), action);
  }
  const report = (error) => {
    output.appendLine(String(error?.stack || error));
    vscode.window.showErrorMessage(`codex-companion: ${error.message || error}`);
  };
  const provider = {
    onDidChangeTreeData: changed.event,
    getChildren(row) {
      if (!row) return [limitsNode, ...sessions];
      if (row.kind === 'limits') {
        const children = (limits?.windows || []).map(window => ({ kind: 'limitWindow', window }));
        if (limits?.usageBlocked) children.unshift({ kind: 'notice', title: '現在、通常の利用が制限されています' });
        if (!children.length) children.push({
          kind: 'notice',
          title: limitsError ? '利用枠を取得できませんでした' : limitsRefreshing ? '利用枠を取得中…' : '利用枠の情報がありません'
        });
        return children;
      }
      return [];
    },
    getTreeItem(row) {
      if (row.kind === 'limits') {
        const item = new vscode.TreeItem('アカウント全体の利用枠', vscode.TreeItemCollapsibleState.Expanded);
        item.id = 'codexCompanion.accountLimits';
        item.contextValue = 'codexAccountLimits';
        item.description = limitsError ? (limits ? '取得失敗 / 前回値' : '取得失敗') : limitsRefreshing ? '更新中' : '約1分ごと更新';
        item.iconPath = new vscode.ThemeIcon('account');
        return item;
      }
      if (row.kind === 'limitWindow') {
        const display = describeWindow(row.window, limits.fetchedAt, limitsError);
        const item = new vscode.TreeItem(row.window.label);
        item.id = `codexCompanion.limit.${row.window.id}`;
        item.description = display.description;
        item.tooltip = display.tooltip;
        item.iconPath = new vscode.ThemeIcon(display.icon, new vscode.ThemeColor(display.color));
        item.command = { command: 'codexCompanion.refreshLimits', title: '利用枠を更新' };
        return item;
      }
      if (row.kind === 'notice') {
        const item = new vscode.TreeItem(row.title);
        item.iconPath = new vscode.ThemeIcon('info');
        item.command = { command: 'codexCompanion.refreshLimits', title: '利用枠を更新' };
        item.tooltip = 'クリックして利用枠を再取得します。取得できない理由は「出力 → codex-companion」で確認できます。';
        return item;
      }
      const item = new vscode.TreeItem(row.title || '無題の会話');
      const display = describeTelemetry(row.telemetry);
      item.description = display.description;
      item.tooltip = `${row.title}\n会話更新: ${new Date(row.time).toLocaleString()}\n\n${display.detail}`;
      item.iconPath = new vscode.ThemeIcon(display.icon, new vscode.ThemeColor(display.color));
      item.contextValue = 'codexSession';
      item.command = { command: 'codexCompanion.open', title: '開く', arguments: [row] };
      return item;
    }
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
        output.appendLine(`利用枠の取得失敗: ${error.message}`);
      }
    })();
    changed.fire(limitsNode);
    try { await limitsRefreshing; } finally {
      limitsRefreshing = undefined;
      if (!telemetryDisposed) changed.fire(limitsNode);
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
      if (!telemetryDisposed) changed.fire();
    } finally { telemetryUpdating = false; }
  }
  async function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        sessions = await backend(request => listSessions(request, config().get('maxSessions', 200)));
      } catch (error) {
        output.appendLine(`会話管理 API の取得失敗（インデックスを表示）: ${error.message}`);
        sessions = await readSessions(path.join(home(), 'session_index.jsonl'), config().get('maxSessions', 200));
      }
      await updateTelemetry();
      changed.fire();
    })();
    try { await refreshing; } finally { refreshing = undefined; }
  }
  async function openRoute(route, column, query = '') {
    const extension = vscode.extensions.getExtension('openai.chatgpt');
    if (!extension) throw new Error('公式 Codex 拡張（openai.chatgpt）が必要です。');
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
      label: row.title || '無題の会話',
      description: describeTelemetry(row.telemetry).description, row
    })), { placeHolder: '保存済みの Codex 会話を検索', matchOnDescription: true });
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
      title: 'Codex の会話名を変更', value: row.title,
      validateInput: value => value.trim() ? undefined : '名前を入力してください。'
    });
    if (name === undefined || name.trim() === row.title) return;
    await backend(request => request('thread/name/set', { threadId: row.id, name: name.trim() }));
    if (refreshing) await refreshing;
    await refresh();
    vscode.window.showInformationMessage('会話名を変更しました。開いている公式タブのタイトルは、開き直すと反映されます。');
  }
  async function archive(row) {
    if (!row) return;
    conversationPath(row.id);
    const answer = await vscode.window.showWarningMessage(
      `「${row.title}」をアーカイブしますか？`,
      { modal: true, detail: '派生した子会話も対象になる場合があります。実行中の会話は完了を待ってください。アーカイブした会話を戻す操作も用意しています。' },
      'アーカイブ');
    if (answer !== 'アーカイブ') return;
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
    if (!archived.length) { vscode.window.showInformationMessage('アーカイブ済みの会話はありません。'); return; }
    const selected = await vscode.window.showQuickPick(archived.map(row => ({ label: row.title, row })),
      { placeHolder: 'アーカイブから戻す会話を選択' });
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
      vscode.window.showInformationMessage('復元できる会話タブはまだありません。');
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
    open: openSession,
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
  const tree = vscode.window.createTreeView('codexCompanion.sessions', { treeDataProvider: provider });
  const telemetryTimer = setInterval(() => {
    if (tree.visible && !refreshing) updateTelemetry().catch(error => output.appendLine(String(error)));
    if (tree.visible && Date.now() - limitsAttemptedAt >= 60000) refreshLimits().catch(report);
  }, 10000);
  context.subscriptions.push(
    changed, output,
    tree,
    tree.onDidChangeVisibility(event => {
      if (event.visible) {
        updateTelemetry().catch(report);
        if (Date.now() - limitsAttemptedAt >= 60000) refreshLimits().catch(report);
      }
    }),
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
