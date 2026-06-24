# Fix parent repository SCM integration implementation plan

## Checklist

- [x] Re-check current repository and Git watcher code before editing.
- [x] Add a small extension-host service or helper for VS Code Git parent repository alignment.
  - [x] Define narrow local types for VS Code Git API repository root access.
  - [x] Detect Intelli Git scopes where `gitRoot !== workspaceRoot`.
  - [x] Compare normalized `gitRoot` against VS Code Git `rootUri.fsPath`.
  - [x] De-duplicate missing parent roots.
  - [x] Suppress repeat prompts per session.
- [x] Wire the service from `activate()` using existing `RepositoryManager` events and dispose it through `context.subscriptions`.
- [x] Show localized VS Code UI only after a missing parent root is confirmed.
  - [x] Primary action invokes `vscode.commands.executeCommand('git.openRepositoriesInParentFolders')`.
  - [x] Secondary action opens settings for `git.openRepositoryInParentFolders`.
  - [x] Catch command failures without breaking Intelli Git activation.
- [x] Add l10n entries to `packages/shared/l10n/bundle.l10n.json` and `packages/shared/l10n/bundle.l10n.zh-cn.json`.
- [x] Add or update tests for parent-root detection and prompt de-duplication.
- [x] Run validation.
- [x] Review diff for scope, l10n, and prompt spam.

## Candidate files

- `apps/extension/src/extension.ts`
- `apps/extension/src/services/GitRepositoryWatcher.ts` or a new service under `apps/extension/src/services/`
- `apps/extension/src/services/RepositoryManager.ts` if a tiny public helper is needed, though prefer existing `getRepositories()`
- `apps/extension/src/test/mocks/vscode.ts` if tests need Git extension or command mocks
- `apps/extension/src/services/*.test.ts`
- `packages/shared/l10n/bundle.l10n.json`
- `packages/shared/l10n/bundle.l10n.zh-cn.json`

## Validation

- `npm run compile --workspace intelli-git`
- Focused extension-host tests for the new service
- `npm run test --workspace intelli-git` if focused tests are clean and runtime is acceptable

## Rollback points

- If VS Code command invocation is unreliable, keep detection and replace primary action with settings guidance only.
- If Git API mocking becomes too broad, isolate pure detection into a testable helper and keep VS Code API activation in a thin service boundary.
- If activation prompt timing is noisy, defer the check to repository changes plus a short debounce instead of immediate activation.

## Review gates before start

- PRD has no blocking open questions.
- Design preserves subdirectory-scoped Intelli Git status.
- Implementation does not change persistent repository identity or changelist state keys.
- User approves moving from planning to implementation.
