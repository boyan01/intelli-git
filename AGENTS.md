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
