# Extension Host Directory Structure

## Ownership Boundaries

`apps/extension/src/extension.ts` is the activation and wiring root. Keep it focused on creating long-lived services, providers, status bars, watchers, and command registrations. Put feature behavior in the existing directories instead of adding more activation-time logic.

Reference files:
- `apps/extension/src/extension.ts`
- `apps/extension/src/providers/CommitViewProvider.ts`
- `apps/extension/src/services/RepositoryManager.ts`

## Directory Roles

- `src/commands/`: VS Code command registration modules. Each module accepts the services/providers it needs through parameters and registers commands on `context.subscriptions`.
- `src/providers/`: Webview view providers and content providers. Providers own webview lifecycle, HTML creation, and provider-scoped RPC setup.
- `src/rpc/`: Extension-side RPC bridge. `ExtensionRpcHandler.ts` coordinates feature RPC methods and delegates read/changelist subsets to focused handlers.
- `src/services/`: Durable feature state and Git operations. `GitService`, `RepositoryManager`, `ChangelistStateService`, `InactiveChangesService`, and `GitLogService` are the main source of truth for extension behavior.
- `src/operations/`: Cross-service operation helpers, especially changelist operations that need Git plus state refresh.
- `src/ui/`: Native VS Code UI helpers such as status bars, quick picks, and conflict prompts.
- `src/utils/`: Shared extension utilities such as l10n, logging, diff parsing, push protection, and webview HTML generation.
- `src/editor/`: Editor integration for hunk/change-block commands and decorations.

Avoid placing durable changelist, repository, or Git mutation logic in providers or command files. Providers and commands should orchestrate services.

## Build And Generated Output

The extension is bundled by `apps/extension/scripts/build-extension.js` into `apps/extension/out/extension.js`. The webview bundle is built by `apps/webview-ui/vite.config.ts` into `apps/extension/out/webview`.

Do not edit `apps/extension/out/` by hand. Treat it as build output.

L10n files are authored in `packages/shared/l10n/` and copied into `apps/extension/l10n/` by `apps/extension/scripts/sync-l10n.js`. When adding user-facing strings, update the shared bundle source and let the build/sync flow update extension output.

## Shared Imports

Both extension and webview import shared contracts through the `@shared/*` alias. In extension code this alias is configured in `apps/extension/tsconfig.json` and `apps/extension/scripts/build-extension.js`.

Reference files:
- `apps/extension/tsconfig.json`
- `apps/extension/scripts/build-extension.js`
- `packages/shared/messages.ts`

Avoid duplicating shared message, RPC, or context-menu types inside `apps/extension`. If both sides need the shape, it belongs in `packages/shared`.
