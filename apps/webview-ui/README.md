# Intelli Git Webview UI

This workspace contains the React + Vite application rendered inside the Intelli Git VS Code webviews.

## Responsibilities

- Render the Commit, Stash, Push, and Git Log views.
- Communicate with the extension host through the shared RPC contract in `packages/shared`.
- Keep webview state cached through VS Code webview state APIs.
- Use shared localization bundles from `packages/shared/l10n`.

## Development

Run the webview build from the monorepo root:

```bash
npm run build --workspace webview-ui
```

Run the webview in watch mode while developing the extension:

```bash
npm run watch --workspace webview-ui
```

The extension build copies the webview output into `apps/extension/out/webview`.

## Notes

- User-facing text must use `react-i18next` and the shared l10n bundles.
- UI should follow VS Code theme variables and existing CSS Modules patterns.
- Selectable tree-like rows should use `BasicTreeView` unless there is a clear reason not to.
