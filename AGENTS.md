# Project Context: Intelli Git

## Overview
This is a VS Code Extension project named "intelli-git" that provides a commit panel and git log visualization.

## Architecture
- **Extension Host (`src`)**: Handles git operations, VS Code integration, and business logic.
- **Webview UI (`webview-ui`)**: A React application (Vite) that provides the user interface.
- **Shared (`shared`)**: Code shared between the extension host and webview.

## Rules & Guidelines
**Source**: `.agent/rules/code-style-guide.md`

### Communication
- **AI Language**: All responses, thinking process, and todo lists MUST be in **Simplified Chinese (简体中文)**.
- **Code Language**: All code, comments, and documentation MUST be in **English**.

### Code Style
- **Naming**:
  - React Components: `PascalCase.tsx`
  - Services/Classes: `PascalCase.ts`
  - Functions/Variables: `camelCase`
  - Constants: `UPPER_SNAKE_CASE` (global) or `camelCase` (local)
- **Frontend (Webview)**:
  - Use Functional Components with Hooks.
  - Use CSS Modules (`*.module.css`).
  - Use VS Code CSS variables for theming.
- **Backend (Extension)**:
  - Use Service classes for logic.
  - Use Dependency Injection.
  - Use `async/await`.

### Localization (l10n)
All user-facing text **MUST** be localized. Never hardcode display strings directly.

The project has **two l10n layers** with different mechanisms:

#### 1. Extension Host (`vscode.l10n`)
For text shown via VS Code native APIs (notifications, input boxes, status bar, etc.):
- Use `vscode.l10n.t('English text')` or the wrapper `i18n.t()` from `src/utils/i18n.ts`.
- Dynamic values use positional placeholders: `vscode.l10n.t('Created branch {0} at {1}', name, hash)`.
- **Adding a new string:**
  1. Add the English text as a key-value pair in `packages/shared/l10n/bundle.l10n.json`.
  2. Add the Chinese translation in `packages/shared/l10n/bundle.l10n.zh-cn.json`.
  3. The `sync:l10n` script copies these files to `apps/extension/l10n/` during build.

#### 2. `package.json` Contributions (`package.nls`)
For text declared in `package.json` (command titles, config descriptions, view names, etc.):
- Reference keys with `%key%` syntax in `package.json`, e.g. `"title": "%intelli-git.commands.refresh.title%"`.
- **Adding a new string:**
  1. Add the key-value pair in `apps/extension/package.nls.json` (English).
  2. Add the Chinese translation in `apps/extension/package.nls.zh-cn.json`.

#### 3. Webview UI (`i18next` / `react-i18next`)
For text shown in the React Webview:
- Use the `useTranslation` hook: `const { t } = useTranslation();` then `t('Key text')`.
- Use `{{variable}}` for interpolation: `t('{{count}} files', { count: 3 })`.
- Translation files are in `packages/shared/l10n/` (shared with Extension Host).
- **Adding a new string:**
  1. Add the English key-value pair in `packages/shared/l10n/bundle.l10n.json`.
  2. Add the Chinese translation in `packages/shared/l10n/bundle.l10n.zh-cn.json`.

> **Note**: Webview and Extension Host share the same `bundle.l10n.*.json` files, but they use different interpolation syntax (`{{var}}` for i18next vs `{0}` for vscode.l10n). Use the correct syntax for each layer.

## Workflows
**Source**: `.agent/workflows/`

### Adding Context Menus
See `.agent/workflows/add-context-menu.md` for details on how to add native VS Code context menus triggered from the Webview.
1. Define command in `package.json`.
2. Configure menu in `package.json` (`menus` -> `webview/context`).
3. Add `data-vscode-context` attribute to HTML elements in Webview.
4. Register command handler in Extension host.

## Project Structure
- `src/` - Extension source code
- `webview-ui/` - React Webview source code
- `.agent/` - AI Agent rules and workflows
