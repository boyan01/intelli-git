# Webview Type Safety

## Shared Imports

Import cross-boundary contracts from `@shared/messages` and context menu payloads from `@shared/webviewContext`.

Examples:
- `CommitView.tsx` imports `BranchInfo`, `ChangelistState`, `FileStatus`, `RepositoryCommitViewState`, and `RepositoryFileReference`.
- `ChangelistTree.tsx` imports context payload types from `@shared/webviewContext`.
- `rpc_client.ts` imports `ExtensionMethods` and `WebviewMethods`.

Do not duplicate shared types in the webview package.

## Local View Models

Use local interfaces for view-only data attached to tree nodes or component props. Keep them close to the component or model helper that owns them.

Reference file:
- `apps/webview-ui/src/components/commit/ChangelistTree.tsx`

For tree data, type `TreeNode<T>` with a concrete data interface instead of storing untyped object bags.

## RPC Calls

Call extension methods through `rpc`, which is typed from `ExtensionMethods`. Register webview event methods in `rpc_client.ts` with `WebviewMethods`.

When adding an RPC endpoint:
- add the method to `packages/shared/messages.ts`
- implement/register it in the extension RPC handler
- call it through `rpc` in the webview
- add tests for non-trivial request/response behavior

## Context Payloads

Use `satisfies` or imported context interfaces for `data-vscode-context` payloads when the shape is non-trivial. Keep `preventDefaultContextMenuItems` aligned with native context-menu behavior.

Reference file:
- `packages/shared/webviewContext.ts`

## Anti-Patterns

- Avoid `any` in component props, hook return values, and feature models.
- Avoid passing raw JSON strings through components when a typed object can be serialized at the DOM boundary.
- Avoid string literals for modes or sections when shared union types already exist.
