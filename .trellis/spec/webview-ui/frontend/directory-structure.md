# Webview UI Directory Structure

## Feature Folders

Feature UI lives under `apps/webview-ui/src/components/<feature>/`.

Current feature folders:
- `commit/`: commit panel, changelist tree, toolbar, commit form, rebase form, commit message state.
- `git-log/`: Git log view, graph rendering, filters, branch/log panels.
- `local-changes/`: repository/worktree entry points and worktree drawer.
- `push/`: push review UI, push target helpers, footer/header/tab layout.
- `stash/`: stash view.
- `file-tree/`: file tree rendering helpers shared by feature trees.
- `common/`: reusable UI primitives such as `BasicTreeView`, `LoadingProgressBar`, `SplitPane`, and commit detail display.

Keep feature-specific models and persisted-state keys near the feature, as in `components/commit/changelistModel.ts` and `components/git-log/persistedState.ts`.

## Hooks And Lib

Use `src/hooks/` for reusable React hooks and `src/lib/` for platform bridge helpers.

Reference files:
- `apps/webview-ui/src/hooks/useRpcData.ts`
- `apps/webview-ui/src/hooks/usePersistedState.ts`
- `apps/webview-ui/src/lib/rpc_client.ts`
- `apps/webview-ui/src/lib/stateCache.ts`
- `apps/webview-ui/src/lib/persistedStateRegistry.ts`

Do not place VS Code acquire/postMessage logic inside feature components. Go through `lib/vscode.ts` and `lib/rpc_client.ts`.

## Assets

Seti icon metadata lives in `src/assets/seti-icons/` and is consumed through `src/lib/fileIcons.ts`. Keep static assets out of feature component folders unless they are feature-private and loaded by Vite.

## Build Output

Vite builds the webview into `apps/extension/out/webview`. Do not edit that output by hand.

Reference file:
- `apps/webview-ui/vite.config.ts`

## Imports

The webview supports both `@shared/*` and `@/*` aliases through `tsconfig.app.json` and `vite.config.ts`. Use `@shared/*` for cross-package contracts and `@/*` for local webview imports when it improves readability.
