# Shared Package Quality Guidelines

## Cross-Package Checks

Because `packages/shared` is imported by both workspaces, validate contract changes from the repo root:

- `npm run compile`
- `npm run test`
- `npm run lint`

Use workspace-specific tests when the contract change affects one runtime heavily:
- `npm run test --workspace intelli-git`
- `npm run test --workspace webview-ui`

## RPC Tests

Transport behavior is covered by extension-side regression tests such as `apps/extension/src/rpc/RpcPeer.regression.test.ts`. Add similar focused tests for timeout, error code/data propagation, or handler registration changes.

Feature RPC behavior should be tested near the feature handler, for example `apps/extension/src/rpc/ExtensionRpcHandler.test.ts`.

## L10n Checks

Keep the two shared l10n bundles in sync. Webview text changes should pass:

```bash
npm run audit:l10n --workspace webview-ui
```

Extension l10n output is synced from shared bundles into `apps/extension/l10n/` by `apps/extension/scripts/sync-l10n.js`.

## Review Checklist

- Both runtimes compile with the new contract.
- Optional fields are truly optional for older or fallback states.
- Context payload changes have matching package contribution and DOM producer changes.
- L10n keys exist in both English and Simplified Chinese bundles.
- No runtime-specific dependency was added to `packages/shared`.

## Anti-Patterns

- Do not add broad shared abstractions before two real consumers need them.
- Do not use `any` in exported contracts.
- Do not skip app-side tests when a shared type changes behavior.
