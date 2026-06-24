# Extension Host State Management

## Repository-Scoped State

State that depends on a repository must be scoped by repository path. `RepositoryManager` normalizes paths and creates one `GitService`, `InactiveChangesService`, and `ChangelistStateService` per repository scope.

Reference files:
- `apps/extension/src/services/RepositoryManager.ts`
- `apps/extension/src/services/ChangelistStateService.ts`
- `apps/extension/src/services/InactiveChangesService.ts`

When migrating older global state, preserve the existing migration pattern: only the repository that previously owned global workspace state should receive it.

## Changelist Invariants

`ChangelistStateService` is the source of truth for changelist mode, list membership, active list, and hunk assignments. It must keep these invariants:

- `changes` and `inactive-changes` default lists always exist.
- `inactive-changes` is never the active changelist.
- There is always a valid active non-inactive list.
- Deleting a list moves file and hunk assignments to the fallback list instead of dropping them.
- Invalid assignments are removed during invariant repair.

Do not reimplement these rules in webview local state. The webview may derive display groups, but durable assignments belong in the extension service.

## Git Mutations And Local Changes

Git mutations that can disturb local changes should use the existing temporary stash pattern in `GitService.withTemporaryStash(...)`. The pattern snapshots Intelli Git state, runs the Git operation, restores the stash with `--index`, restores extension state, and reports explicit recovery details on failure.

Reference files:
- `apps/extension/src/services/GitService.ts`
- `apps/extension/src/services/GitBranchRemoteService.ts`

Do not silently fall back to a lossy behavior for staged state, inactive changes, hunk assignments, untracked files, or changelists.

## Path Conversion

Keep repository paths and workspace paths explicit. `GitService.toRepoPath(...)` and `GitService.toWorkspacePath(...)` handle opened-folder-inside-repo cases. Tests such as `GitService repository scope` cover this behavior.

Avoid passing raw absolute paths through shared contracts unless the contract explicitly asks for repository identity. Shared file references use `RepositoryFileReference` when repo disambiguation is needed.

## Caches

Invalidate Git log graph caches through `GitService.fireChange()` after Git mutations. Avoid cache invalidation from unrelated UI code.
