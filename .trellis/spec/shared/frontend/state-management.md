# Shared State Contract Guidelines

## Serializable Shapes

Shared state must be serializable through VS Code webview `postMessage`. Use plain objects, arrays, strings, numbers, booleans, `null`, and optional fields.

Examples:
- `CommitViewState`
- `RepositoryCommitViewState`
- `ChangelistState`
- `PushRequest`
- `PublishReviewBranchResult`

Avoid `Date`, `Map`, `Set`, functions, class instances, or Node/VS Code objects in shared contracts.

## Ownership Boundaries

Shared types describe state; they do not own state. Runtime ownership is:

- extension services: durable Git, repository, changelist, inactive-change, stash, branch, and secret state
- webview: UI preferences, cached display state, drafts, expanded rows, selected UI rows
- shared: compile-time contract between the two

Do not add shared mutable state.

## Repository Identity

For multi-repository flows, include `repoPath` where a file path alone can collide. `RepositoryFileReference` and `RepositoryCommitViewState` are the established pattern.

Do not assume `path` is globally unique across workspace, submodule, and worktree repositories.

## Context State

Context menu payloads should include the minimum state needed for command enablement and execution. Keep booleans explicit, as in `ChangelistFileContext` and `WorktreeItemContext`, so package contribution `when` clauses and command handlers do not need to recalculate UI state.

## Anti-Patterns

- Do not use shared contracts as caches.
- Do not expose extension implementation details such as storage keys in shared contracts.
- Do not remove fields from shared contracts without checking both extension and webview usage.
