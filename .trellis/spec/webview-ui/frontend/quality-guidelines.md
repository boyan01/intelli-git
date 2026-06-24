# Webview Quality Guidelines

## Tests

Use Vitest for pure logic, model transforms, hooks, and regression utilities. Existing focused tests are the best examples:

- `apps/webview-ui/src/components/commit/changelistModel.test.ts`
- `apps/webview-ui/src/components/commit/commitMessageUpdate.test.ts`
- `apps/webview-ui/src/components/git-log/inlineCommitLayout.test.ts`
- `apps/webview-ui/src/components/push/pushError.test.ts`
- `apps/webview-ui/src/hooks/useVersionCheck.test.ts`
- `apps/webview-ui/src/lib/persistedStateRegistry.test.ts`

Prefer tests around pure helpers for tree grouping, selection, parsing, filtering, and persisted-state behavior. Add component/browser checks when layout or interaction cannot be covered by pure functions.

## L10n Audit

All user-facing webview text must use `useTranslation()` or an approved translated helper. The audit script scans JSX text, selected attributes, and translation keys.

Reference files:
- `apps/webview-ui/scripts/audit-l10n.mjs`
- `apps/webview-ui/src/i18n.ts`
- `packages/shared/l10n/bundle.l10n.json`
- `packages/shared/l10n/bundle.l10n.zh-cn.json`

When an untranslated visual marker is intentional, add a narrow ignore entry with a reason in `audit-l10n.mjs`.

## UI Verification

For UI/UX changes, show the intended shape with an ASCII UI sketch during review. Keep changes consistent with VS Code, not a standalone website.

Checklist:
- text fits in compact VS Code panels
- no overlapping toolbar or tree content
- hover, selected, and focused states use VS Code list tokens
- loading feedback is delayed and non-blocking
- native context menus still receive the right `data-vscode-context`

## Commands

- `npm run build --workspace webview-ui`
- `npm run test --workspace webview-ui`
- `npm run audit:l10n --workspace webview-ui`
- root `npm run lint` before finishing cross-workspace UI text changes

## Anti-Patterns

- Do not introduce a new frontend stack.
- Do not create duplicate spinner/progress components for page data loading.
- Do not add hard-coded English or Chinese visible strings in React components.
