# Project Context: Intelli Git

## Overview
This repository is a monorepo for the VS Code extension `intelli-git`.
It provides:
- a local changes / commit panel
- a git log panel
- related branch, stash, changelist, and AI-assisted git workflows

## Monorepo Architecture

### Workspace Layout
- `apps/extension` - VS Code extension host, command registration, providers, services, packaging scripts, extension manifest
- `apps/webview-ui` - React + Vite webview application rendered inside VS Code webviews
- `packages/shared` - shared RPC types, shared message contracts, shared localization bundles
- `.agent/workflows` - agent workflow notes used during implementation

### Extension Host (`apps/extension`)
Main entry: `apps/extension/src/extension.ts`

Responsibilities:
- activate the extension
- initialize `GitService` and `InactiveChangesService`
- register webview providers
- register commands
- register content providers for revision / stash views
- wire repository watching and refresh events
- manage VS Code native UI integrations such as status bar items

Key subfolders:
- `apps/extension/src/commands` - command registration grouped by feature
- `apps/extension/src/providers` - webview view providers and content providers
- `apps/extension/src/services` - git, watcher, AI, and state-related services
- `apps/extension/src/rpc` - extension side RPC bridge for webview communication
- `apps/extension/src/ui` - native VS Code UI helpers such as status bars and pickers
- `apps/extension/src/utils` - shared extension utilities

### Webview UI (`apps/webview-ui`)
Main entry: `apps/webview-ui/src/App.tsx`

Current route structure:
- `/` - local changes / commit view
- `/git-log` - git log view

Responsibilities:
- render the webview UI with React function components
- communicate with the extension host through RPC
- show commit, changelist, push, stash, and git log related views
- keep webview-side cached state and interaction logic

Key subfolders:
- `apps/webview-ui/src/components` - feature UI components
- `apps/webview-ui/src/hooks` - reusable React hooks
- `apps/webview-ui/src/lib` - VS Code bridge, RPC client, state cache, file icon helpers
- `apps/webview-ui/src/utils` - UI utility helpers

### Shared Package (`packages/shared`)
Responsibilities:
- define shared RPC primitives
- define shared messages / contracts
- hold localization bundles shared by extension host and webview

Important files:
- `packages/shared/rpc.ts`
- `packages/shared/messages.ts`
- `packages/shared/l10n/bundle.l10n.json`
- `packages/shared/l10n/bundle.l10n.zh-cn.json`

## Development Commands

### Root Scripts
- `npm run compile` - compile all workspaces
- `npm run watch` - watch all workspaces that expose a watch script
- `npm run watch:extension` - run extension and webview watch together
- `npm run lint` - lint all workspaces
- `npm run test` - run workspace tests if present
- `npm run package:extension:dev` - build/package the extension in dev mode

### Workspace Notes
- Root package uses npm workspaces: `apps/*` and `packages/*`
- `apps/webview-ui` uses Vite
- `apps/extension` uses custom build scripts and syncs l10n assets into `apps/extension/l10n`

## Communication Rules
- All responses, analysis, and todo notes MUST be in Simplified Chinese.
- All code, comments, commit messages, and technical strings written into source files MUST be in English.

## Code Style

### Naming
- React components: `PascalCase.tsx`
- Services / classes: `PascalCase.ts`
- Functions / variables: `camelCase`
- Global constants: `UPPER_SNAKE_CASE`

### Frontend (Webview)
- Use functional components with hooks.
- Prefer CSS Modules for component styles.
- Use VS Code theme variables for colors and theming when integrating with the existing UI language.
- Preserve the current React + Vite structure instead of introducing a new frontend stack.

### Backend (Extension)
- Keep feature logic inside service classes when appropriate.
- Use `async/await`.
- Follow the existing dependency injection style through constructor / registration wiring instead of adding global singletons casually.

## Localization (l10n)
All user-facing text MUST be localized. Never hardcode display strings directly.

### 1. Extension Host (`vscode.l10n`)
For text shown via VS Code native APIs:
- use `vscode.l10n.t('English text')`
- or use `i18n.t()` from `apps/extension/src/utils/i18n.ts`
- dynamic values use positional placeholders such as `{0}`

When adding a new string:
1. Add the English entry to `packages/shared/l10n/bundle.l10n.json`
2. Add the Chinese entry to `packages/shared/l10n/bundle.l10n.zh-cn.json`
3. Ensure extension l10n output stays in sync via the existing sync script/build flow

### 2. `package.json` Contributions (`package.nls`)
For text declared in `apps/extension/package.json`:
- use `%key%` syntax

When adding a new string:
1. Add the English key to `apps/extension/package.nls.json`
2. Add the Chinese key to `apps/extension/package.nls.zh-cn.json`

### 3. Webview UI (`i18next` / `react-i18next`)
For text shown in React webviews:
- use `useTranslation`
- use `{{variable}}` interpolation syntax

When adding a new string:
1. Add the English entry to `packages/shared/l10n/bundle.l10n.json`
2. Add the Chinese entry to `packages/shared/l10n/bundle.l10n.zh-cn.json`

### Interpolation Note
Webview and extension host share the same l10n bundle files, but interpolation syntax differs:
- webview: `{{var}}`
- extension host: `{0}`

Use the syntax required by the runtime you are editing for.

## Workflows

### Adding Context Menus
See `.agent/workflows/add-context-menu.md`.

For webview-triggered native VS Code context menus:
1. Define the command in `apps/extension/package.json`
2. Add the menu contribution under `menus.webview/context`
3. Add `data-vscode-context` on the target webview element
4. Register the command handler in the extension host

## Project Structure Summary
- `apps/extension/` - extension host code and packaging
- `apps/webview-ui/` - React webview app
- `packages/shared/` - shared contracts and l10n
- `.agent/workflows/` - workflow docs
