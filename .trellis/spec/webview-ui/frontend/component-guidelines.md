# Webview Component Guidelines

## Component Shape

Use function components and hooks. Keep feature orchestration in view components such as `CommitView.tsx` and put reusable interactions into common components or hooks.

Reference files:
- `apps/webview-ui/src/components/commit/CommitView.tsx`
- `apps/webview-ui/src/components/git-log/GitLogView.tsx`
- `apps/webview-ui/src/components/push/PushChangesView.tsx`

Define props with local `interface` declarations near the component. Import shared data types from `@shared/messages`.

## Tree And Selectable Lists

Selectable tree/list rows should use `BasicTreeView`. It already owns hover, selected, focused, keyboard focus, sticky headers, virtualization, drag/drop, and `data-vscode-context` plumbing.

Reference files:
- `apps/webview-ui/src/components/common/BasicTreeView.tsx`
- `apps/webview-ui/src/components/commit/ChangelistTree.tsx`
- `apps/webview-ui/src/components/local-changes/WorktreeDrawer.tsx`
- `apps/webview-ui/src/components/git-log/BranchListPanel.tsx`

Do not add feature-specific button-row selection CSS for tree-like lists unless `BasicTreeView` cannot represent the interaction.

## Styling

Use CSS Modules next to the component. Prefer VS Code theme tokens for colors and focus states:

- `--vscode-list-hoverBackground`
- `--vscode-list-inactiveSelectionBackground`
- `--vscode-list-activeSelectionBackground`
- `--vscode-list-focusOutline`
- `--vscode-progressBar-background`
- Git decoration tokens for file status colors

Reference files:
- `apps/webview-ui/src/components/common/BasicTreeView.module.css`
- `apps/webview-ui/src/components/common/LoadingProgressBar.module.css`
- `apps/webview-ui/src/components/commit/CommitView.module.css`

Keep rows and fixed controls dimensionally stable. `BasicTreeView` uses a 22px row height and virtualization constants; avoid dynamic row heights inside that tree.

## Loading And Empty States

For local RPC data loads, keep existing content visible and show `LoadingProgressBar` only after the delay. Do not replace fast local refreshes with centered spinners or whole-page blocking states.

Use centered state panels for stable no repository, empty, error, or expired-version states.

Reference files:
- `apps/webview-ui/src/components/common/LoadingProgressBar.tsx`
- `apps/webview-ui/src/components/commit/CommitView.tsx`
- `apps/webview-ui/src/components/common/VersionExpiredPanel.tsx`

## Accessibility

Use semantic button elements for commands and provide accessible labels where icon-only UI is used. `BasicTreeView` exposes `ariaLabel` and row focus handling; keep those wired when wrapping it.

## Anti-Patterns

- Do not hard-code visible strings. Use `useTranslation()`.
- Do not add custom DOM context menus for native VS Code webview context menu flows.
- Do not add page-level marketing or decorative layouts inside webviews. This product is a dense VS Code tool surface.
