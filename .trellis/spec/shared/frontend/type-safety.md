# Shared Type Safety

## Union Types

Use string union types for finite domains. Existing examples:

- `GitStatusCode`
- `RemoteProvider`
- `AiProviderId`
- `CommitMessageGenerationMode`
- `CommitAiAction`
- `ChangelistMode`
- `PushFailureCode`
- `WebviewContextSection`

Prefer extending the union in shared over introducing ad hoc string values in app code.

## Interfaces

Use interfaces for exported object contracts and keep names domain-specific. Add optional fields when older or fallback states legitimately omit data.

Examples:
- `RepositoryInfo` includes optional worktree and detached-head metadata.
- `FileStatus` includes optional hunk, inactive, conflict, and error metadata.
- `CommitDetails` includes full detail fields used by Git log and common commit details UI.

## RPC Generics

`RpcPeer<TRemote, TLocal>` uses generic schemas so each side gets a typed proxy. Keep the public generic API stable when changing transport internals.

Reference file:
- `packages/shared/rpc.ts`

Contained `any` is acceptable inside the generic transport implementation. Exported feature contracts should stay typed.

## Error Codes

Use exported constants for stable error codes when webview behavior depends on a specific failure.

Examples:
- `AI_PROVIDER_SETUP_REQUIRED_CODE`
- `AI_COPILOT_MODEL_UNAVAILABLE_CODE`

Do not rely on matching localized or human-readable error text.

## Anti-Patterns

- Do not export enums for simple string domains unless there is a concrete runtime need.
- Do not put `unknown` or `any` into request/response fields without a documented validation boundary.
- Do not encode structured state in strings when an object contract is available.
