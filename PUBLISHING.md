# Publishing codex-companion

Project, directory, package, display name, and GitHub repository: `codex-companion`.
Marketplace extension identifier: `rmsc.codex-companion`.
The `rmsc` publisher matches this author's other local extensions; publishing
requires access to that publisher in Visual Studio Marketplace.

## Build

Use Node.js 22 or later.

```sh
npm ci
npm run check
npm test
npm run package
```

Output: `codex-companion-0.6.0.vsix`.
The `files` allowlist includes only runtime JavaScript, package metadata,
README, changelog, and license. Tests, development tools, credentials and
local Codex conversations are not included.

CI builds and uploads the VSIX as a workflow artifact; it does not publish.
CI tests the index parser on Windows and Linux. The isolated real-Codex
integration test runs only when `CODEX_COMPANION_TEST_BINARY` is provided.

## Upgrade from the local prototype

The old identifier was `local-tools.codex-tabs`. This is a different extension
identifier, so installing the renamed package does not replace the prototype.
Disable/uninstall the old extension to avoid duplicate views.
Saved tab snapshots and custom settings are not automatically migrated.
Conversation titles and archives are Codex data and remain intact.

## Publish manually

1. Verify the VSIX in VS Code: open two saved conversations, switch file tabs,
   rename a test conversation, archive it, and restore it.
2. If publishing source, change the GitHub repository visibility to public.
3. Sign in to https://marketplace.visualstudio.com/manage and choose publisher
   `rmsc`. Confirm you own/have access to that publisher.
4. Choose **New extension → Visual Studio Code** and upload the built VSIX.
5. Verify the listing at
   https://marketplace.visualstudio.com/items?itemName=rmsc.codex-companion
   after Marketplace validation completes.

Alternatively use `npx vsce publish` with publisher authentication configured.
Never commit publishing tokens. This repository does not include a token
or an automatic Marketplace publishing workflow.

The VSIX can also be distributed through a GitHub release.
No release or Marketplace listing is created by the build command.

## Compatibility

Verified locally: Windows x64 with `openai.chatgpt` version `26.1007.21434`.
The editor route is a private integration and can change in future Codex
releases. macOS, Linux, Remote SSH and WSL UI behavior still need manual checks.

Official publishing reference:
https://code.visualstudio.com/api/working-with-extensions/publishing-extension
