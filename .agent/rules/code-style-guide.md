---
trigger: always_on
---

# Code Style Guide

This guide outlines the coding standards and best practices for the Intelli Git project. It is designed to ensure consistency across the codebase and guide future development by AI agents and human developers.

## 1. Project Structure

The project is a VS Code Extension with a webview-based UI.

- **Root (`/`)**: VS Code Extension configuration (`package.json`, `tsconfig.json`).
- **Extension Host (`/src`)**: Backend logic running in the VS Code Node.js environment.
    - **Services**: Business logic (e.g., `GitService.ts`).
    - **Providers**: Data providers for TreeViews or Webviews.
    - **Commands**: Command registration logic.
- **Webview UI (`/webview-ui`)**: Frontend UI running inside a VS Code Webview.
    - **Tech Stack**: React, Vite, TypeScript.
    - **Components**: Reusable UI components.
    - **Screens/Views**: Main page views.
- **Shared (`/shared`)**: Types, interfaces, l10n and utilities shared between Extension Host and Webview UI.

## 2. Technology Stack

- **Language**: TypeScript (Strict mode enabled).
- **Frontend**: React 19, Vite, React Router DOM, CSS Modules.
- **UI Toolkit**: `@vscode/webview-ui-toolkit`, `@vscode/codicons`.
- **Backend (Extension)**: VS Code API, `simple-git`.
- **Linting/Formatting**: ESLint.

## 3. General Principles

- **Language**: All code, comments, and documentation must be in **English**.
- **Comments**:
    - **Explain WHY, not WHAT.** The code should be self-documenting.
    - Keep comments concise and focused on design decisions or complex logic.
- **i18n**:
    - **Extension**: Use `%key%` in `package.json` and `vscode.l10n` API in code.
    - **Webview**: Use `react-i18next` for UI strings.
    - **Do not hardcode strings** visible to the user.

## 4. Naming Conventions

- **Files**:
    - React Components: `PascalCase.tsx` (e.g., `FilterMenu.tsx`).
    - Logic/Services: `PascalCase.ts` (e.g., `GitService.ts`).
    - CSS Modules: `PascalCase.module.css` (e.g., `FilterToolbar.module.css`).
    - Utilities/Functions: `camelCase.ts` (e.g., `fileUtils.ts`).
- **Variables/Functions**: `camelCase`.
- **Classes/Interfaces/Types**: `PascalCase`.
- **Constants**: `UPPER_SNAKE_CASE` (for global constants), `camelCase` (for local constants).
- **Private Properties (Classes)**: No prefix or `_` prefix (consistency within file). Ideally use `private` keyword.

## 5. TypeScript Best Practices

- **Strict Types**: Avoid `any`. Use `unknown` if the type is truly not known yet, but prefer defining interfaces.
- **Interfaces vs Types**: Prefer `interface` for object shapes and defining public APIs. Use `type` for unions or primitives.
- **Explicit Returns**: Explicitly type return values for functions, especially public methods in services.
- **Async/Await**: Prefer `async/await` over raw Promises (`.then`).

## 6. React Best Practices (Webview UI)

- **Functional Components**: Use Functional Components (`React.FC<Props>`) with Hooks. Class components are discouraged.
- **Hooks**:
    - Follow the Rules of Hooks.
    - Custom hooks should start with `use`.
- **State Management**:
    - Keep state local where possible.
    - Pass data down via props.
    - Use Context sparingly for truly global data.
- **Performance**:
    - Use `useMemo` and `useCallback` for expensive calculations or reference stability.
    - Avoid unnecessary re-renders.

## 7. CSS and Styling

- **CSS Modules**: Use CSS Modules (`*.module.css`) for component-scoped styling to avoid namespace collisions.
- **Standard CSS**: Use standard CSS syntax. Avoid SASS/LESS unless configured (currently standard CSS).
- **VS Code Theme Integration**:
    - **Use CSS Variables**: Rely on VS Code CSS variables (e.g., `var(--vscode-button-background)`) to ensure the UI looks native and supports themes.
    - Refer to VS Code Webview UI Toolkit documentation for variable names.

## 8. Extension Host Best Practices (Backend)

- **Services**: Encapsulate logic in Service classes (e.g., `GitService`).
- **Dependency Injection**: Pass dependencies (like `GitService`) into Providers or other Services via the constructor.
- **Error Handling**: Use `try/catch` blocks in async operations, especially when interacting with file system or Git. Log errors appropriately.
- **Disposables**: Push disposables (commands, providers) to `context.subscriptions`.

## 9. Code Example (React Component)

```tsx
import React from 'react';
import styles from './MyComponent.module.css';

interface MyComponentProps {
    label: string;
    onClick: () => void;
}

export const MyComponent: React.FC<MyComponentProps> = ({ label, onClick }) => {
    return (
        <button className={styles.button} onClick={onClick}>
            {label}
        </button>
    );
};
```

## 10. Code Example (Service Class)

```typescript
import * as vscode from 'vscode';

export class MyService {
    constructor(private readonly _workspaceRoot: string) {}

    /**
     * Fetches data from the source.
     * Use explicit return type.
     */
    public async getData(): Promise<string[]> {
        try {
            // ... implementation
            return [];
        } catch (error) {
            console.error('Failed to get data:', error);
            throw error;
        }
    }
}
```