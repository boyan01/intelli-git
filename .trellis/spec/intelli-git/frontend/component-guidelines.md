# Extension Host Component Guidelines

## Service Classes

Use service classes for durable extension behavior and stateful integrations. The local pattern is constructor injection plus explicit public methods, not global singletons.

Examples:
- `RepositoryManager` owns repository discovery, active repository reconciliation, user-added repositories, hidden repositories, and service instances.
- `GitService` wraps `simple-git`, path conversion, diff parsing, temporary stash protection, Git log access, and branch remote operations.
- `ChangelistStateService` owns mode, list invariants, assignments, snapshots, and repository-scoped persistence.

When adding behavior that must survive refresh/reopen or coordinate with Git, put it in a service or operation layer. Do not keep it only in a webview provider or webview local state.

## Providers

Providers own VS Code webview lifecycle and bridge setup. Keep feature logic behind services and RPC handlers.

Reference files:
- `apps/extension/src/providers/CommitViewProvider.ts`
- `apps/extension/src/providers/GitLogViewProvider.ts`
- `apps/extension/src/providers/BaseWebviewProvider.ts`

Provider changes often need matching updates in:
- `apps/extension/src/rpc/ExtensionRpcHandler.ts`
- `packages/shared/messages.ts`
- `apps/webview-ui/src/lib/rpc_client.ts`

## Commands

Command modules should register commands for one feature area and receive dependencies from activation wiring. Keep target resolution and user-facing VS Code feedback in the command boundary, then delegate durable mutations to services or operations.

Reference files:
- `apps/extension/src/commands/changelistCommands.ts`
- `apps/extension/src/commands/registerBranchCommands.ts`
- `apps/extension/src/commands/registerLogCommands.ts`

For webview context menu commands, keep the four surfaces in sync:
- command contribution in `apps/extension/package.json`
- localized title in `apps/extension/package.nls*.json`
- context payload in `packages/shared/webviewContext.ts`
- command handler in `apps/extension/src/commands/*`

## Native UI Helpers

Put QuickPick, status bar, and message-flow helpers under `src/ui/` when they have reusable behavior or non-trivial state. Short command-specific prompts can stay near the command handler.

Reference files:
- `apps/extension/src/ui/BranchPicker.ts`
- `apps/extension/src/ui/BranchStatusBar.ts`
- `apps/extension/src/ui/checkoutWorktreeConflict.ts`

## Anti-Patterns

- Do not add thin wrapper functions that only rename an existing function.
- Do not add global singletons for services already created from `activate`.
- Do not put long Git mutation sequences directly inside command registration callbacks.
- Do not hard-code user-facing strings in VS Code UI calls.
