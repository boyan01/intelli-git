# Webview UI Frontend Guidelines

`apps/webview-ui` is the React + Vite application rendered inside VS Code webviews. It owns UI rendering, webview-local cached state, RPC calls, list/tree interactions, and VS Code-themed CSS. Durable Git, changelist, repository, and command behavior belongs in `apps/extension`.

## Guides

| Guide | Use For |
|-------|---------|
| [Directory Structure](./directory-structure.md) | Feature folders, common UI, hooks, lib, assets |
| [Component Guidelines](./component-guidelines.md) | React component shape, tree/list UI, styling, accessibility |
| [Hook Guidelines](./hook-guidelines.md) | RPC loading, persisted state, event subscriptions |
| [State Management](./state-management.md) | Derived view state, cached state, changelist display model |
| [Quality Guidelines](./quality-guidelines.md) | Tests, l10n audit, loading feedback, UI verification |
| [Type Safety](./type-safety.md) | Shared imports, local view models, context payloads |

## Pre-Development Checklist

- Confirm whether the state change belongs in webview local state or extension-side services.
- For selectable tree/list rows, prefer `BasicTreeView` over ad hoc row selection styles.
- For user-facing text, use `useTranslation()` and update `packages/shared/l10n/*`.
- For loading data from RPC, prefer `useRpcData` and delayed `LoadingProgressBar` over blocking spinners.
- Keep CSS in CSS Modules and use VS Code theme variables.

## Quality Check

- Run `npm run build --workspace webview-ui`.
- Run `npm run test --workspace webview-ui` when utility, model, hook, or view-state logic changes.
- Run `npm run audit:l10n --workspace webview-ui` or root `npm run lint` after UI text changes.
