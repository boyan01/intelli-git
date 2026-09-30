# Intelli Git

JetBrains-style Git workflows for Visual Studio Code.

Intelli Git is a free, open-source VS Code extension for developers who prefer IntelliJ-style changelists and regularly split local work into precise commits. It adds a focused commit panel, Git Log, stash tools, push workflows, and optional AI-assisted commit message generation without replacing VS Code's built-in Git extension.

[Install from Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=boyan01.intelli-git) · [Download a VSIX](https://github.com/boyan01/intelli-git/releases) · [Report an issue](https://github.com/boyan01/intelli-git/issues)

This repository contains the extension source code, development history, documentation, and releases. Intelli Git is licensed under GPL-3.0-or-later and can be used for personal or commercial work. Builds do not expire.

## Screenshots

### Commit View In Staged Mode

Use the familiar Git index workflow with staged, unstaged, untracked, inactive, stash, push, and branch context in one side bar view.

![Intelli Git commit view in staged mode](assets/intelli-git-commit-staged.png)

### Commit View In Changes Mode

Use IntelliJ-style changelists when you want the active changelist to define what gets committed while other work stays visible but separate.

![Intelli Git commit view in changes mode](assets/intelli-git-commit-changes.png)

### Git Log

Browse history with branch filters, commit graph, commit metadata, and details actions from the VS Code panel.

![Intelli Git Git Log panel](assets/intelli-git-log.png)

## Features

- Commit panel with `staged` mode for the normal staged / unstaged Git model.
- `changes` mode with IntelliJ-style changelists and one active changelist.
- Inactive changes for keeping local work out of the current commit flow.
- Native VS Code context menus for files, folders, changelists, stash entries, branches, and commits.
- Git Log with branch filtering, commit graph, file history actions, cherry-pick, revert, reset, and commit message editing.
- Stash and push workflows from the Intelli Git UI.
- AI commit message generation with GitHub Copilot, Codex CLI, Anthropic, Google AI, or a custom OpenAI-compatible endpoint.

## Commit Panel Modes

Intelli Git supports two commit panel modes through `intelli-git.changelist.mode`:

- `staged`: commits follow the Git index. Staged files define the commit selection and staging actions are available from the toolbar and file context menus.
- `changes`: commits use IntelliJ-style changelists. New tracked changes go into the active changelist, and commit execution only includes that active changelist.

Both modes keep the tree file-oriented. Changelist and file context menus use native VS Code webview context menus instead of custom DOM menus.

## AI And Privacy

Intelli Git runs locally inside VS Code and reads Git state from the workspace you open.

AI features are optional. When AI commit message generation is used, selected diff context may be sent to the configured AI provider. No AI request is made unless you invoke an AI action. API keys configured through Intelli Git are stored in VS Code SecretStorage.

## Requirements

- Visual Studio Code 1.100.0 or newer
- Git available on your system path
- A Git repository opened in VS Code

GitHub Copilot mode requires the GitHub Copilot extension. Codex CLI mode requires the CLI installed and authenticated on the extension host. External AI providers require user-provided credentials.

## Usage

Open the Intelli Git activity bar view to review local changes, organize files, create commits, stash changes, and push to remotes.

Open the Git Log panel to browse commit history, filter by branch or path, inspect commit files, and run commit-level actions.

Run `Intelli: Configure AI Provider` from the Command Palette to choose an AI provider and configure credentials.

## Development

### Prerequisites

- Node.js 22.13.0+ or 20.19.0+
- VS Code

### Clone And Install Dependencies

```bash
git clone https://github.com/boyan01/intelli-git.git
cd intelli-git
npm ci
```

### Build

```bash
# Full build (webview + extension TypeScript)
npm run compile

# Build webview only
npm run build:webview --workspace intelli-git

# Watch extension and webview builds together
npm run watch:extension

# Watch mode for webview UI
npm run watch --workspace webview-ui
```

### Quality Checks

```bash
npm run lint
npm run compile
npm run test
```

### Package

```bash
# Create a Marketplace-ready .vsix package
npm run package:extension

# Create an Open VSX-ready .vsix package
npm run package:extension:open-vsx

# Create a dev .vsix package
npm run package:extension:dev
```

### Development Workflow

1. Run `npm run watch:extension`
2. Press `F5` in VS Code to launch the Extension Development Host
3. Make changes and reload the extension host to see updates

## Contributing

Bug reports, focused improvements, and pull requests are welcome. Include reproducible steps for bugs and discuss larger changes in an issue before implementing them.

Follow the repository guidance in [AGENTS.md](AGENTS.md) and run the quality checks above before submitting a pull request. Contributions are licensed under GPL-3.0-or-later.

## Releases And Source Code

New releases are built from version tags such as `v0.0.10` in this repository. Each release includes the VSIX and a link to the corresponding source tag, including the build scripts. Existing tags and releases are preserved. Earlier `v0.0.x` tags from the documentation repository do not contain the extension source; the corresponding source commits retain their original `intelli-git-extension-v0.0.x` tags.

To build a release from source, check out its source tag, run `npm ci`, and then run `npm run package:extension`.

## License

Copyright (c) 2026 yangbin.

Intelli Git is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version (`GPL-3.0-or-later`).

Intelli Git is distributed without any warranty. See [LICENSE](LICENSE) for the full license text. Third-party components retain their own licenses; see [ThirdPartyNotices.txt](apps/extension/ThirdPartyNotices.txt).
