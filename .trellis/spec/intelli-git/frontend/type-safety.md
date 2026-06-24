# Extension Host Type Safety

## Shared Contracts

Use `packages/shared/messages.ts` for any type crossing the extension/webview boundary. Extension-side code imports these through `@shared/messages`.

Examples:
- `FileStatus`, `GitHunk`, and `ChangelistState` drive commit view state.
- `RepositoryFileReference` disambiguates files across multiple repositories.
- `ExtensionMethods` and `WebviewMethods` define RPC endpoints.

Do not define a local duplicate of a shared RPC or state shape in `apps/extension`.

## Service Interfaces

Keep constructor dependencies explicit and typed. `ExtensionRpcHandlerOptions`, `GitService` constructor parameters, and `RepositoryScope` show the local pattern.

For tests that need private internals, use a narrow local interface cast in the test, as in `GitService.test.ts`, rather than widening production visibility.

## Path And Context Types

Use specific context payload interfaces for webview context menus. The authoritative shared set is `packages/shared/webviewContext.ts`; command modules may define local narrowed interfaces only for command argument handling.

When adding fields to a webview context payload, update both:
- the shared payload type in `packages/shared/webviewContext.ts`
- the webview element's `data-vscode-context` producer

## Error Types

When the caller needs machine-readable errors, attach `code` and optional `data` through the existing RPC error pattern. Do not parse human-readable messages in the webview.

Reference files:
- `apps/extension/src/rpc/ExtensionRpcHandler.ts`
- `packages/shared/rpc.ts`

## Anti-Patterns

- Avoid `any` at feature boundaries. Existing `any` in `RpcPeer` is contained inside the generic transport implementation.
- Avoid raw object literals for complex shared payloads without `satisfies` or an imported interface.
- Avoid stringly typed repository kinds, modes, or status codes when shared union types already exist.
