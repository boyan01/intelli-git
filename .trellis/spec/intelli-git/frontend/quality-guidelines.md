# Extension Host Quality Guidelines

## Tests

Use Vitest for extension host behavior. Existing tests are practical examples for service-level and regression coverage:

- `apps/extension/src/services/GitService.test.ts`
- `apps/extension/src/services/ChangelistStateService.test.ts`
- `apps/extension/src/services/RepositoryManager.test.ts`
- `apps/extension/src/rpc/ExtensionRpcHandler.test.ts`
- `apps/extension/src/utils/diffParser.test.ts`
- `apps/extension/src/commands/commandPalette.regression.test.ts`

Git behavior tests often create temporary repositories with `fs.mkdtempSync`, `simple-git`, and real commits. Prefer that style for Git semantics over hand-mocking command output.

## L10n

For VS Code native UI text, use `vscode.l10n.t(...)` or `i18n.t(...)`. `i18n.t(...)` supports keyed `extension.*` messages from shared l10n bundles and falls back to `vscode.l10n.t(...)` for plain strings.

When adding strings:
- update `packages/shared/l10n/bundle.l10n.json`
- update `packages/shared/l10n/bundle.l10n.zh-cn.json`
- if the string is a package contribution, update `apps/extension/package.nls.json` and `apps/extension/package.nls.zh-cn.json`

Reference files:
- `apps/extension/src/utils/i18n.ts`
- `apps/extension/scripts/sync-l10n.js`
- `apps/extension/package.nls.json`

## Release And Packaging

Release work must respect the product-level tag format `intelli-git-extension-vx.x.x`. The version source is `apps/extension/package.json`, with the workspace lockfile kept in sync.

Packaging scripts use `INTELLI_GIT_BUILD_CHANNEL` and build macros from `apps/extension/scripts/build-extension.js` and `apps/webview-ui/vite.config.ts`. Do not change one side without checking the other.

For Marketplace/Open VSX work, inspect the final VSIX/readme output. Source README links can differ from packaged README links after `vsce` rewriting.

## Verification Commands

- `npm run compile --workspace intelli-git`
- `npm run test --workspace intelli-git`
- `npm run package:extension:dev` for packaging-sensitive changes
- root `npm run lint` for cross-workspace l10n/lint checks

## Anti-Patterns

- Do not add broad docs churn when a script-level fallback or guard would solve the workflow issue.
- Do not push non-urgent release/docs/workflow edits before local review.
- Do not treat generated `out/` files as source.
