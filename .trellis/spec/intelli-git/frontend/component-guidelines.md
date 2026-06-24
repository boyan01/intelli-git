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

## Scenario: VS Code Git Parent Repository Alignment

### 1. Scope / Trigger

Use this pattern when Intelli Git detects a Git repository state that belongs to VS Code's built-in Git integration, such as an opened subdirectory whose actual `gitRoot` is a parent folder. This is an extension-host infrastructure integration, not a webview concern.

### 2. Signatures

- Built-in Git extension lookup: `vscode.extensions.getExtension<VSCodeGitExtension>('vscode.git')`
- Git API access: `gitExtension.exports.getAPI(1)`
- Repository roots: `api.repositories[*].rootUri.fsPath`
- Parent repository command: `vscode.commands.executeCommand('git.openRepositoriesInParentFolders')`
- Settings command: `vscode.commands.executeCommand('workbench.action.openSettings', 'git.openRepositoryInParentFolders')`

### 3. Contracts

- Intelli Git repository scopes come from `RepositoryManager.getRepositories()`.
- `RepositoryScope.workspaceRoot` is the opened folder identity.
- `RepositoryScope.gitRoot` is the real Git top-level path.
- A split-brain candidate is `normalize(scope.gitRoot) !== normalize(scope.workspaceRoot)` and `scope.gitRoot` is absent from VS Code Git `rootUri.fsPath` values.
- Intelli Git may prompt the user to invoke VS Code's parent-repository command, but must not silently change `git.openRepositoryInParentFolders` or implement duplicate Explorer/editor decorations.

### 4. Validation & Error Matrix

- VS Code Git extension unavailable -> do nothing; Intelli Git continues with its own repository model.
- VS Code Git API activation fails -> log/debug only; do not block extension activation.
- Parent root already opened by VS Code Git -> no warning.
- Parent root missing from VS Code Git -> show one localized recovery prompt per session/root.
- User chooses parent-repository action -> execute `git.openRepositoriesInParentFolders`.
- User chooses settings action -> open `git.openRepositoryInParentFolders` settings.
- Command execution fails -> warn/log and suppress repeated prompts for that root in the current session.

### 5. Good/Base/Bad Cases

- Good: opening `project-a/backend` shows backend-scoped Intelli Git changes and offers a VS Code Git alignment action if `project-a` is not open in Source Control.
- Base: opening `project-a` at the repository root shows no parent-repository warning.
- Bad: silently changing user settings, showing `frontend` changes in a backend-only window, or creating Intelli Git-owned file decorations to mask VS Code Git state.

### 6. Tests Required

- Unit-test pure detection of missing parent roots.
- Assert root-opened repositories are skipped.
- Assert parent roots already opened by VS Code Git do not prompt.
- Assert multiple workspace scopes under the same parent root deduplicate to one prompt.
- Assert the primary action calls `git.openRepositoriesInParentFolders`.
- Assert the secondary action opens `git.openRepositoryInParentFolders` settings.

### 7. Wrong vs Correct

#### Wrong

```typescript
await vscode.workspace.getConfiguration('git').update('openRepositoryInParentFolders', 'always');
```

This silently changes the user's VS Code behavior.

#### Correct

```typescript
const selected = await vscode.window.showWarningMessage(message, openAction, settingsAction);
if (selected === openAction) {
    await vscode.commands.executeCommand('git.openRepositoriesInParentFolders');
}
```

This keeps VS Code Git as the owner of Source Control state and requires an explicit user action.

## Anti-Patterns

- Do not add thin wrapper functions that only rename an existing function.
- Do not add global singletons for services already created from `activate`.
- Do not put long Git mutation sequences directly inside command registration callbacks.
- Do not hard-code user-facing strings in VS Code UI calls.
