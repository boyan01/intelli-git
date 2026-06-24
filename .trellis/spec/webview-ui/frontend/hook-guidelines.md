# Webview Hook Guidelines

## RPC Data Loading

Use `useRpcData` for RPC-backed view state. It handles initial value, refresh event subscription, optional persisted cache, loading state, errors, and reload.

Reference file:
- `apps/webview-ui/src/hooks/useRpcData.ts`

When refreshing existing data, pass `loadingOnRefresh: true` only when the component displays a delayed progress bar and keeps prior content visible.

## RPC Events

Subscribe to webview events through `rpcEvents` from `src/lib/rpc_client.ts`. Return the unsubscribe function from `useEffect`.

Reference files:
- `apps/webview-ui/src/lib/rpc_client.ts`
- `apps/webview-ui/src/components/commit/CommitView.tsx`

Do not attach raw `window.message` listeners in feature components. The single transport listener belongs in `rpc_client.ts`.

## Persisted State

Use `usePersistedState` for user-visible webview preferences such as view mode, expanded nodes, commit message draft, and amend state.

Feature-specific keys and schemas should be registered through the persisted-state registry, not ad hoc JSON parsing in components.

Reference files:
- `apps/webview-ui/src/hooks/usePersistedState.ts`
- `apps/webview-ui/src/lib/persistedStateRegistry.ts`
- `apps/webview-ui/src/components/commit/persistedState.ts`
- `apps/webview-ui/src/components/git-log/persistedState.ts`

## Memoization

Use `useMemo` and `useCallback` for derived tree groups, selected file maps, handler props, and heavy transforms passed into common components. This is especially important for changelist and Git log views.

Reference files:
- `apps/webview-ui/src/components/commit/CommitView.tsx`
- `apps/webview-ui/src/components/commit/ChangelistTree.tsx`
- `apps/webview-ui/src/components/git-log/hooks/useLogCommitLoader.ts`

## Async Effects

Guard stale async responses with request ids or cleanup when a later request can supersede an earlier one. `CommitView` uses `lastCommitInfoRequestRef` while switching amend mode.

Avoid setting state after a component-level async operation if the result is no longer relevant to the current props or refs.
