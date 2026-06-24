# Shared Package Directory Structure

## Files

- `packages/shared/messages.ts`: shared data models, RPC method interfaces, request/response types, and domain unions used by extension and webview.
- `packages/shared/rpc.ts`: generic bidirectional RPC transport over `postMessage`.
- `packages/shared/webviewContext.ts`: typed `data-vscode-context` payloads for VS Code native webview context menus.
- `packages/shared/l10n/bundle.l10n.json`: English messages.
- `packages/shared/l10n/bundle.l10n.zh-cn.json`: Simplified Chinese messages.

Keep this package small. If a helper imports React, VS Code, Node-only APIs, simple-git, or CSS, it belongs in `apps/webview-ui` or `apps/extension`, not shared.

## Package Export Shape

`packages/shared/package.json` exports `./*`, so consumers import concrete files through `@shared/messages`, `@shared/rpc`, `@shared/webviewContext`, or `@shared/l10n/...`.

Do not depend on barrel files unless the package intentionally adds one later. Current code imports direct modules.

## L10n Ownership

The shared l10n bundle is the source for both:
- webview i18next resources in `apps/webview-ui/src/i18n.ts`
- extension l10n sync output in `apps/extension/l10n/`

Extension package contribution strings are separate and live in `apps/extension/package.nls*.json`.

## Anti-Patterns

- Do not put feature services, UI components, hooks, or Git operations in `packages/shared`.
- Do not split every feature into separate shared files unless the single `messages.ts` becomes hard to navigate.
- Do not add generated output under `packages/shared`.
