# Intelli Git

[![Visual Studio Marketplace Version](https://vsmarketplacebadges.dev/version/boyan01.intelli-git.svg?style=flat-square&color=blue&label=Marketplace)](https://marketplace.visualstudio.com/items?itemName=boyan01.intelli-git)
[![Visual Studio Marketplace Installs](https://vsmarketplacebadges.dev/installs/boyan01.intelli-git.svg?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=boyan01.intelli-git)
[![Open VSX Version](https://img.shields.io/open-vsx/v/boyan01/intelli-git?style=flat-square&label=Open%20VSX&color=purple)](https://open-vsx.org/extension/boyan01/intelli-git)
[![License: GPL-3.0-or-later](https://img.shields.io/badge/License-GPL--3.0--or--later-blue.svg?style=flat-square)](LICENSE)
[![VS Code Engine](https://img.shields.io/badge/VS%20Code-%3E%3D%201.100.0-007ACC.svg?style=flat-square&logo=visual-studio-code)](https://code.visualstudio.com/)

**The JetBrains-style Git tool suite for Visual Studio Code.**

Intelli Git brings an IntelliJ IDEA-style Git workflow to VS Code. Organize changes into **changelists**, review diffs, browse commit history in an interactive **Git Log graph**, and manage branches, **worktrees, and stashes** from the editor.

[Install from Marketplace](https://marketplace.visualstudio.com/items?itemName=boyan01.intelli-git) · [Install from Open VSX](https://open-vsx.org/extension/boyan01/intelli-git) · [Releases & VSIX](https://github.com/boyan01/intelli-git/releases) · [Report Issue](https://github.com/boyan01/intelli-git/issues)

---

## ✨ Key Features

- 📑 **IntelliJ-Style Changelists:** Organize code into multiple independent changelists. Work on multiple tasks or quick fixes simultaneously, and commit only the active changelist.
- ⚡ **Dedicated Commit Panel:** Review diffs, stage files, mark changes as inactive, and review conflicts in a separate group. Commit and push from the same panel.
- 🌲 **Interactive Git Log & Commit Graph:** Browse commit lanes and topology, filter by branch/author/path, inspect commit diffs, and perform cherry-pick, revert, or branch operations directly from the graph.
- 🌿 **First-Class Git Worktree Support:** Manage parallel worktrees via a dedicated drawer—switch, reveal, open, or prune stale worktrees.
- 📦 **Stash & Multi-Repo Tools:** Inspect stash diffs, pop, apply, drop, and switch between multiple workspace repositories.
- 🤖 **Flexible AI Commit Assistance:** Generate conventional commit messages, pull request titles, and summaries using GitHub Copilot, Codex CLI, Anthropic Claude, Google Gemini, or any custom OpenAI-compatible endpoint.

---

## 🚀 Getting Started

### Requirements

- **VS Code**: `1.100.0` or newer
- **Git**: Installed and available in your system `PATH`
- A workspace containing one or more Git repositories

### Installation & Quick Start

1. Install **Intelli Git** from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=boyan01.intelli-git) or download the latest VSIX from [GitHub Releases](https://github.com/boyan01/intelli-git/releases).
2. Click the **Intelli Git** icon on the Activity Bar, or press `Ctrl+Shift+P` / `Cmd+Shift+P` and run:
   ```text
   Intelli: Focus Commit View
   ```
3. Run `Focus Git Log` to open the **Git Log** view in the bottom panel and explore repository history.

---

## 🔄 Choose Your Commit Workflow

Intelli Git supports two commit workflows. Choose one in settings:

```json
{
  "intelli-git.changelist.mode": "changes"
}
```

| Feature           | `changes` Mode (IntelliJ Style)                                       | `staged` Mode (Classic Git Style, Default)          |
| :---------------- | :-------------------------------------------------------------------- | :-------------------------------------------------- |
| **Commit Target** | Only changes in the **Active Changelist**                             | All changes currently in the **Git Index (Staged)** |
| **Multitasking**  | Move files/hunks across named changelists                             | Use `Mark as Inactive Changes` to set work aside    |
| **Context Menus** | `Create Changelist`, `Set Active Changelist`, `Move to Changelist...` | `Stage`, `Unstage`, `Mark as Inactive Changes`      |
| **Best For**      | Parallel tasks, bugfixes mid-feature, clean commits                   | Traditional git add / git commit mental models      |

Move files between changelists from the commit panel. To move an individual hunk, hover over its change block in the editor and choose `Move to Changelist...`.

Inactive changes remain in the working tree and can be moved back to active changes when needed.

---

## 📸 Screenshots

### Changelists Mode

Group changes by task, isolate work-in-progress, and commit only what is ready.

![Intelli Git commit view in changes mode](assets/intelli-git-commit-changes.png)

### Staged Mode

Stage, unstage, and mark changes as inactive without losing diff context.

![Intelli Git commit view in staged mode](assets/intelli-git-commit-staged.png)

### Interactive Git Log Panel

Explore commit lanes, branch topology, author details, and diffs with fast filtering.

![Intelli Git Git Log panel](assets/intelli-git-log.png)

---

## 🤖 AI Commit Messages

Intelli Git includes smart AI commit message generation tailored to your exact staged or changelist diff.

Run **`Intelli: Configure AI Provider`** from the Command Palette to choose your backend:

- **GitHub Copilot**: Uses your active VS Code Copilot subscription (supports model selection).
- **Codex CLI**: Integrates directly with your local authenticated Codex CLI.
- **Anthropic Claude**: Connect with your Anthropic API Key (Claude 3.5 Sonnet, etc.).
- **Google Gemini**: Connect with your Google AI Studio API Key.
- **Custom OpenAI-Compatible**: Self-hosted models, Ollama, DeepSeek, OpenRouter, or vLLM.

> **Privacy & Security**: AI generation is strictly opt-in. Diff context is sent only when explicitly requested. API keys are encrypted in VS Code's native `SecretStorage`.

---

## ⌨️ Common Commands

| Command                          | Description                                           |
| :------------------------------- | :---------------------------------------------------- |
| `Intelli: Focus Commit View`     | Reveal the Intelli Git commit panel                   |
| `Focus Git Log`                  | Open the interactive commit graph in the bottom panel |
| `Worktrees`                      | View, switch, and prune Git worktrees                 |
| `Intelli: Switch Branch`         | Open the branch switch / checkout dialog              |
| `Intelli: Configure AI Provider` | Switch or configure AI backends & API keys            |
| `Push...`                        | Push commits with protected branch confirmation       |

---

## ⚙️ Key Settings

| Setting                                   | Default                 | Description                                                        |
| :---------------------------------------- | :---------------------- | :----------------------------------------------------------------- |
| `intelli-git.changelist.mode`             | `"staged"`              | Workflow mode: `"staged"` or `"changes"`                           |
| `intelli-git.ai.provider`                 | `"copilot"`             | AI backend: `copilot`, `codex`, `anthropic`, `google`, or `custom` |
| `intelli-git.ai.commitPrompt`             | _(Conventional Commit)_ | Custom prompt template for commit generation                       |
| `intelli-git.backgroundFetch.enabled`     | `false`                 | Periodically fetch remotes in the background                       |
| `intelli-git.push.confirmProtectedBranch` | `true`                  | Prompt for confirmation when pushing to protected branches         |

---

## 🛠️ Development & Contributing

Intelli Git is organized as a monorepo (`apps/extension`, `apps/webview-ui`, `packages/shared`).

Use the Node.js version specified in [.nvmrc](.nvmrc).

```bash
# 1. Clone repository
git clone https://github.com/boyan01/intelli-git.git
cd intelli-git

# 2. Install dependencies & compile
npm ci
npm run compile

# 3. Start development watchers
npm run watch:extension
```

Press `F5` in VS Code to launch the **Extension Development Host**.

### Quality Checks & Packaging

```bash
npm run format        # Apply the repository's Prettier style
npm run format:check  # Check formatting without changing files
npm run lint          # Run linter across all workspaces
npm run typecheck     # Check extension, webview and shared TypeScript
npm run test          # Execute tests
npm run test:release  # Check release scripts and VSIX validation
npm run check         # Run all checks above without rewriting files
npm run package:extension:dev # Build dev VSIX into out/
```

The CI workflow runs on branch pushes, pull requests and merge queues. It checks formatting, lint (including shared code and the webview localization audit), TypeScript, unit/regression tests, release scripts, and production VSIX packaging. Use `npm run check` and `npm run package:extension` to run the same checks locally. Generated assets and lockfiles are excluded from formatting.

Contributions are welcome! Please follow [AGENTS.md](AGENTS.md) conventions for commit messages, architecture rules, and testing requirements before opening a PR.

---

## 📄 License

Copyright (c) 2026 yangbin.

Licensed under the [GNU General Public License v3.0 or later (GPL-3.0-or-later)](LICENSE).
Third-party notices and licenses are documented in [ThirdPartyNotices.txt](apps/extension/ThirdPartyNotices.txt).
