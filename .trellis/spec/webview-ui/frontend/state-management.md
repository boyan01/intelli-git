# Webview State Management

## Extension State Is Source Of Truth

Durable Git, repository, changelist, inactive-change, stash, and branch state belongs in extension-side services. The webview fetches it through RPC and derives display models.

Reference files:
- `apps/webview-ui/src/components/commit/CommitView.tsx`
- `apps/webview-ui/src/components/commit/changelistModel.ts`
- `apps/extension/src/services/ChangelistStateService.ts`

Do not persist changelist assignments only in webview state.

## Derived Display Models

Use local pure model helpers for view-only grouping and selection logic. `changelistModel.ts` converts `RepositoryCommitViewState` and `ChangelistState` into grouped UI data while preserving hunk-level selection semantics behind a file-oriented tree.

Reference tests:
- `apps/webview-ui/src/components/commit/changelistModel.test.ts`
- `apps/webview-ui/src/components/git-log/graphUtils.test.ts`
- `apps/webview-ui/src/components/push/pushTarget.test.ts`

When a display rule is non-trivial, add a pure helper and test it instead of burying it in JSX.

## Cached Reopen State

Use persisted state for UI preferences and drafts:
- commit view mode, expanded tree ids, commit message draft, amend state
- git log filters and selection
- local changes and push panel state

Keep cache serialization in `persistedStateRegistry.ts` so `Set`, dates, or complex values round-trip predictably.

## Multi-Repository State

Commit view may receive multiple `RepositoryCommitViewState` entries. Selection and grouping must preserve `repoPath` to avoid collisions between repositories with the same file path.

Reference files:
- `packages/shared/messages.ts`
- `apps/webview-ui/src/components/commit/changelistModel.ts`

## Anti-Patterns

- Do not use array indices as durable selection ids.
- Do not derive commit selection only from visible tree rows when hunk-level assignment exists.
- Do not discard previous data during a refresh unless the feature is intentionally resetting state.
