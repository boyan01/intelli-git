# Intelli Git

IntelliJ-style Git workflows for Visual Studio Code.

Organize work into changelists, review your changes, and commit one task at a time. Intelli Git brings a dedicated commit panel and Git Log to VS Code, with stash, branch, and push tools close at hand.

It is free and open source, and works alongside VS Code's built-in Git support.

[Install](https://marketplace.visualstudio.com/items?itemName=boyan01.intelli-git) · [Source](https://github.com/boyan01/intelli-git) · [Releases](https://github.com/boyan01/intelli-git/releases) · [Issues](https://github.com/boyan01/intelli-git/issues)

## Features

- **Changelists:** keep unrelated work separate and commit the active changelist.
- **Staging:** use the familiar staged / unstaged workflow, with inactive changes for work you want to set aside.
- **Git Log:** browse the commit graph, filter history by branch or path, inspect changes, and cherry-pick or revert commits.
- **Everyday Git tools:** manage stashes, switch branches, push changes, and work across repositories and worktrees.
- **Optional AI assistance:** generate commit messages from the changes you select, using your preferred provider.

## Getting Started

Requires VS Code 1.100.0 or newer, Git on your system path, and a Git repository opened in VS Code.

1. Install **Intelli Git** from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=boyan01.intelli-git), or install a VSIX from [GitHub Releases](https://github.com/boyan01/intelli-git/releases).
2. Open the Intelli Git view in the activity bar, or run `Intelli: Focus Commit View` from the Command Palette.
3. Stage the files you want to commit, or choose an active changelist in `changes` mode. Write your commit message and commit. Open **Git Log** in the bottom panel to explore repository history.

### Choose Your Commit Workflow

Intelli Git starts in `staged` mode. To use IntelliJ-style changelists, add this to your VS Code settings:

```json
{
  "intelli-git.changelist.mode": "changes"
}
```

| Mode | What gets committed |
| --- | --- |
| `changes` | Changes assigned to the active changelist. Other changelists stay out of the commit. |
| `staged` (default) | Changes in the Git index. Stage and unstage files to choose what to commit. |

In `changes` mode, use the context menus to create changelists, move files between them, and choose the active list. In `staged` mode, you can mark changes as inactive to keep them out of the current commit.

## Screenshots

### Changelists

Group changes by task and commit the active changelist.

![Intelli Git commit view in changes mode](https://raw.githubusercontent.com/boyan01/intelli-git/main/assets/intelli-git-commit-changes.png)

### Staging

Review staged, unstaged, and inactive changes in the commit panel.

![Intelli Git commit view in staged mode](https://raw.githubusercontent.com/boyan01/intelli-git/main/assets/intelli-git-commit-staged.png)

### Git Log

Browse the commit graph and inspect a commit's details and changed files.

![Intelli Git Git Log panel](https://raw.githubusercontent.com/boyan01/intelli-git/main/assets/intelli-git-log.png)

## AI Commit Messages

Run `Intelli: Configure AI Provider` from the Command Palette to set up GitHub Copilot, Codex CLI, Anthropic, Google AI, or a custom OpenAI-compatible endpoint.

GitHub Copilot requires its VS Code extension. Codex CLI must be installed and authenticated on the extension host. For external providers, configure your own endpoint and credentials as needed.

AI features are optional. When you invoke generation, selected diff context may be sent to the configured provider. API keys configured through Intelli Git are stored in VS Code SecretStorage.

## Feedback And Contributions

Found a bug or have an idea? [Open an issue](https://github.com/boyan01/intelli-git/issues). Include your Intelli Git and VS Code versions and steps to reproduce the problem. Keep credentials and private code out of public reports.

Source code, build instructions, and contribution guidance are in the [Intelli Git repository](https://github.com/boyan01/intelli-git).

## License

Copyright (c) 2026 yangbin.

Licensed under [GPL-3.0-or-later](LICENSE). Third-party licenses are listed in [ThirdPartyNotices.txt](ThirdPartyNotices.txt).
