# Intelli Git Extension Host Guidelines

This package is the VS Code extension host in `apps/extension`. It owns VS Code activation, command registration, webview providers, Git services, repository discovery, native UI, and release packaging scripts. The webview React app lives in `apps/webview-ui`; shared RPC and l10n contracts live in `packages/shared`.

## Guides

| Guide | Use For |
|-------|---------|
| [Directory Structure](./directory-structure.md) | Extension host ownership boundaries, scripts, generated output |
| [Component Guidelines](./component-guidelines.md) | Providers, command modules, service classes, native VS Code UI helpers |
| [Hook Guidelines](./hook-guidelines.md) | Event wiring, disposables, watchers, and callback lifetimes |
| [State Management](./state-management.md) | Repository-scoped workspace state, changelists, inactive changes, Git refresh |
| [Quality Guidelines](./quality-guidelines.md) | Tests, l10n, release packaging, Git safety |
| [Type Safety](./type-safety.md) | Shared contracts, service interfaces, path and context payload typing |

## Pre-Development Checklist

- Identify whether the change belongs in extension host code, webview UI, or `packages/shared`.
- If a user-facing text is shown through VS Code APIs, use `vscode.l10n.t(...)` or `i18n.t(...)` and update shared l10n bundles when needed.
- If a command or context menu is involved, update all required surfaces together: command registration, `package.json` contribution, context payload type, and handler.
- Preserve repository-scoped behavior for workspace, submodule, and linked worktree repositories.
- Read the relevant service/provider tests before changing Git, changelist, repository, RPC, or release behavior.

## Quality Check

- Run `npm run compile --workspace intelli-git` for extension host type/build coverage.
- Run `npm run test --workspace intelli-git` when service, RPC, parser, command, or release behavior changes.
- Run root `npm run lint` before finishing cross-package changes.
- For release or packaging work, rebuild and inspect the VSIX/readme output instead of checking source markdown only.
