# Extension Events And Lifecycle Guidelines

## Disposables

Every VS Code listener, command registration, provider registration, status bar, watcher, and service with resources must be disposed through `context.subscriptions` or a feature-owned disposable collection.

Reference files:
- `apps/extension/src/extension.ts`
- `apps/extension/src/services/RepositoryManager.ts`
- `apps/extension/src/rpc/createRpc.ts`

The activation root uses separate collections for repository-bound disposables and Git watcher disposables. Preserve that split when adding behavior tied to the active repository.

## Repository Change Flow

Repository-aware features should listen to `RepositoryManager` and active `GitService` events instead of polling. `RepositoryManager` owns scanning workspace folders, user-added repositories, submodules, linked worktrees, and active repository fallback.

When a Git mutation completes through `GitService`, call the service's change notification path so graph caches are invalidated and providers refresh consistently.

Reference files:
- `apps/extension/src/services/GitService.ts`
- `apps/extension/src/services/RepositoryManager.ts`
- `apps/extension/src/services/GitRepositoryWatcher.ts`

## Webview RPC Events

Use `RpcPeer` for bidirectional webview communication. Extension-side setup goes through `createRpc(...)` and `createRpcMessageHandler(...)`; webview-side events are registered in `apps/webview-ui/src/lib/rpc_client.ts`.

RPC handlers should return typed values from `packages/shared/messages.ts`. When adding a new RPC method, update the shared interface and both endpoint registrations in the same change.

## Error And Cancellation Handling

Use structured RPC errors when the webview needs to branch on a failure. The local pattern is `createRpcError(message, code, data)` in `ExtensionRpcHandler.ts` and `RpcError` in `packages/shared/rpc.ts`.

Use best-effort empty catches only for optional VS Code commands where older builds may not expose the command. Document the reason in a short comment, as in `hideEditorHover()` in `changelistCommands.ts`.

## Anti-Patterns

- Do not create watchers without a clear dispose path.
- Do not refresh webviews by ad hoc timers when a repository or service event exists.
- Do not swallow Git mutation failures that affect user data. Surface recovery information through VS Code messages or RPC errors.
