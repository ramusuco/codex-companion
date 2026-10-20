# Changelog

## 0.7.1

- Compact account allowance to the remaining percentage, progress bar, and reset time.
- Remove the allowance heading and routine refresh footer; retain labels only for multiple limits.
- Keep automatic refresh and unavailable/stale indicators.

## 0.7.0

- Combine allowance cards and conversations in one codex-companion panel.
- Keep the list scrollable while allowance cards remain above it.
- Put conversation actions in a compact menu with no hover popup.
- Replace the archive modal with inline Confirm and Cancel controls.
- Update data without rebuilding the panel or closing open action menus.

## 0.6.0

- Move account allowance to a dedicated Codex Usage view with percentage cards and progress bars.
- Keep Codex Sessions flat, remove detailed hover popups, and show only muted context estimates next to titles.
- Use English for companion commands, settings, notifications, and documentation.
- Preserve status icons and expose their labels to screen readers.

## 0.5.0

- Show account-wide remaining allowance and reset times above the session list.
- Refresh account limits about once per minute while visible, with explicit stale/error states.
- Distinguish estimated response activity, completed records, interrupted records, and unknown state with colors and icons.
- Retain per-session context estimates and label them separately from account allowance.

## 0.4.0

- Display recorded session lifecycle and estimated remaining context in the session list.
- Show token counts, context limit, and record timestamps on hover.
- Refresh log metrics every 10 seconds while the view is visible, with bounded reads and caching.
- Explicitly label unavailable metrics and recorded (not live) state.

## 0.3.0

- Rename the project to `codex-companion` and use publisher `rmsc`.
- Include session tabs, split editors, search, rename, archive, unarchive,
  and manual restoration of saved conversation tabs.
- Package with the official VS Code `vsce` tool.
- Add license, publishing instructions, and cross-platform CI.

## 0.2.0 (local prototype)

- Add persistent conversation renaming and archive management through Codex app-server.

## 0.1.0 (local prototype)

- Initial local Codex Tabs prototype.
