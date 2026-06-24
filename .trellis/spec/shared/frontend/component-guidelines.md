# Shared Contract Module Guidelines

## Contract Modules, Not Components

Despite the template layer name, `packages/shared` does not contain React components. Treat this layer as shared TypeScript contracts and transport primitives.

Reference files:
- `packages/shared/messages.ts`
- `packages/shared/rpc.ts`
- `packages/shared/webviewContext.ts`

## Message Contracts

Group related domain types in `messages.ts` and keep names explicit. Existing examples:

- Git/change state: `GitStatusCode`, `GitHunk`, `FileStatus`, `CommitViewState`.
- Changelists: `ChangelistMode`, `ChangelistInfo`, `ChangelistAssignment`, `ChangelistState`.
- Repositories: `RepositoryInfo`, `RepositoryCommitViewState`, `RepositoryFileReference`.
- Git log: `CommitDetails`, `LogOptions`, `GitLogRevealRequest`.
- AI: `AiProviderId`, `CommitAiAction`, generation request/result types.

When a type is only used inside one runtime, keep it in that runtime package.

## RPC Transport

`RpcPeer` is the only shared implementation-style module. It is intentionally generic and runtime-neutral: it only needs an object with `postMessage`.

Reference files:
- `packages/shared/rpc.ts`
- `apps/extension/src/rpc/createRpc.ts`
- `apps/webview-ui/src/lib/rpc_client.ts`

Do not add VS Code or browser-specific behavior to `RpcPeer`; keep runtime adapters in the app packages.

## Context Menu Payloads

`webviewContext.ts` is the authoritative source for native webview context sections and payloads. Add a new section only when it maps to a real `menus.webview/context` contribution or command routing need.

After changing a context payload, update the DOM producer and extension command/menu consumers in the same task.

## Anti-Patterns

- Do not add wrapper functions that only rename a shared type or method.
- Do not include non-serializable values such as functions, class instances, `Date` objects, `Map`, or `Set` in postMessage contracts.
- Do not use shared contracts to bypass feature ownership boundaries.
