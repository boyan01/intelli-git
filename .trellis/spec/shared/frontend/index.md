# Shared Package Guidelines

`packages/shared` is the contract package used by both the VS Code extension host and the webview UI. It owns RPC primitives, shared message types, webview context payload types, and l10n bundles. It should stay implementation-free.

## Guides

| Guide | Use For |
|-------|---------|
| [Directory Structure](./directory-structure.md) | Contract files, l10n bundles, package exports |
| [Component Guidelines](./component-guidelines.md) | Contract module design and what not to put in shared |
| [Hook Guidelines](./hook-guidelines.md) | Event/RPC contract evolution, no React hooks in shared |
| [State Management](./state-management.md) | Serializable state contracts and ownership boundaries |
| [Quality Guidelines](./quality-guidelines.md) | Cross-package validation, l10n sync, RPC tests |
| [Type Safety](./type-safety.md) | Union types, interfaces, generics, runtime error shape |

## Pre-Development Checklist

- Confirm both extension and webview need the type or helper before adding it here.
- Keep exported contracts serializable across `postMessage`.
- Update both runtime sides when changing `ExtensionMethods`, `WebviewMethods`, or context payloads.
- Update English and Simplified Chinese l10n bundles together.
- Do not add VS Code API, React, Node filesystem, or simple-git dependencies to this package.

## Quality Check

- Run root `npm run compile` for cross-workspace type checking.
- Run root `npm run test` when RPC, message, or context contracts change.
- Run `npm run audit:l10n --workspace webview-ui` after l10n bundle changes.
