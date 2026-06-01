# Intelli Git

Intelli Git brings JetBrains-style Git workflows to Visual Studio Code.

It provides a focused commit panel, changelist-style organization, stash tools, push workflows, Git Log browsing, and AI-assisted commit message generation without replacing VS Code's built-in Git support.

## Early Access

Intelli Git is currently free during Early Access.

## Screenshots

### Commit View In Staged Mode

![Intelli Git commit view in staged mode](https://raw.githubusercontent.com/boyan01/intelli-git/main/docs/assets/intelli-git-commit-staged.png)

### Commit View In Changes Mode

![Intelli Git commit view in changes mode](https://raw.githubusercontent.com/boyan01/intelli-git/main/docs/assets/intelli-git-commit-changes.png)

### Git Log

![Intelli Git Git Log panel](https://raw.githubusercontent.com/boyan01/intelli-git/main/docs/assets/intelli-git-log.png)

## Features

- Commit panel with `staged` mode for the normal staged / unstaged Git model.
- `changes` mode with IntelliJ-style changelists and one active changelist.
- Inactive changes for keeping local work out of the current commit flow.
- Native VS Code context menus for files, folders, changelists, stash entries, branches, and commits.
- Git Log with branch filtering, commit graph, file history actions, cherry-pick, revert, reset, and commit message editing.
- Stash and push workflows from the Intelli Git UI.
- AI commit message generation with GitHub Copilot, Anthropic, Google AI, or a custom OpenAI-compatible endpoint.

## Commit Panel Modes

The extension supports two commit panel modes through `intelli-git.changelist.mode`:

- `staged`: follows the normal Git staged and unstaged model.
- `changes`: uses IntelliJ-style changelists and commits only the active changelist.

## Requirements

- Visual Studio Code 1.100.0 or newer
- Git available on your system path
- A Git repository opened in VS Code

AI features are optional. GitHub Copilot mode requires the GitHub Copilot extension. External AI providers require user-provided credentials, stored in VS Code SecretStorage when configured through Intelli Git commands.

## Usage

Open the Intelli Git activity bar view to review local changes, organize files, create commits, stash changes, and push to remotes.

Open the Git Log panel to browse commit history, filter by branch or path, inspect commit files, and run commit-level actions.

Run `Intelli: Configure AI Provider` from the Command Palette to choose an AI provider and configure credentials.

## Privacy

Intelli Git runs locally inside VS Code and reads Git repository state from the workspace you open.

When AI commit message generation is used, selected diff context may be sent to the configured AI provider. No AI request is made unless you invoke an AI action.

API keys are stored with VS Code SecretStorage. Legacy settings-based API keys are migrated and cleared automatically when possible.

## Known Limitations

- Changelist behavior is implemented by the extension and is not a native Git concept.
- Some operations depend on the current repository state and may be blocked by merge conflicts or unsupported Git states.
- AI output quality depends on the selected provider and model.

## Support

For support and issue reporting, see [SUPPORT.md](SUPPORT.md) or open a report in the [Intelli Git repository](https://github.com/boyan01/intelli-git/issues/new/choose).

## License

Proprietary License. See `LICENSE` for details.
