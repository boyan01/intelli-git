# Shared Event And RPC Evolution Guidelines

## No React Hooks In Shared

React hooks belong in `apps/webview-ui/src/hooks`. Shared only defines contracts and runtime-neutral RPC primitives.

Reference webview hook files:
- `apps/webview-ui/src/hooks/useRpcData.ts`
- `apps/webview-ui/src/hooks/usePersistedState.ts`

## Adding RPC Methods

When adding or changing an RPC method:

1. Update `ExtensionMethods` or `WebviewMethods` in `packages/shared/messages.ts`.
2. Implement or register the method on the extension side, usually in `ExtensionRpcHandler`, `GitReadRpcHandler`, or `ChangelistRpcHandler`.
3. Call or emit the method through `apps/webview-ui/src/lib/rpc_client.ts`.
4. Add tests for transport behavior or feature behavior when the method has non-trivial branching.

Reference files:
- `packages/shared/messages.ts`
- `apps/extension/src/rpc/ExtensionRpcHandler.ts`
- `apps/extension/src/rpc/createRpc.ts`
- `apps/webview-ui/src/lib/rpc_client.ts`

## Event Streams

Webview event streams are app-side constructs in `rpc_client.ts`, not shared abstractions. Shared defines method signatures; the webview decides whether an incoming method becomes an `EventStream`.

## Errors

Use `RpcError` for machine-readable failures over RPC. Extension code may attach `errorCode` and `errorData`; webview code should branch on `RpcError.code`, not parse message text.

Reference file:
- `packages/shared/rpc.ts`

## Anti-Patterns

- Do not add a second RPC mechanism.
- Do not create shared event emitter abstractions for one webview-only use case.
- Do not change method parameter shape without updating both endpoint implementations.
