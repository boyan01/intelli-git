# Intelli Git

Intelli Git brings an IntelliJ IDEA inspired Git workflow to Visual Studio Code.

It provides a focused commit panel, changelist-style organization, stash tools, branch actions, Git log browsing, and AI-assisted commit message generation without replacing VS Code's built-in Git support.

## Features

- Commit panel for staged and unstaged changes
- IntelliJ-style changelist mode with one active changelist
- Inactive changes support for keeping work out of the current commit
- File, folder, and changelist context menus using native VS Code menus
- Stash, branch, and push actions from the extension UI
- Git log panel with commit actions and file-level history actions
- AI commit message generation with GitHub Copilot, Anthropic, Google AI, or a custom OpenAI-compatible endpoint

## Screenshot

![Intelli Git overview](https://boyan01.github.io/intelli_git/images/image.png)

## Requirements

- Visual Studio Code 1.100.0 or newer
- Git available on your system path
- A Git repository opened in VS Code

AI features are optional. GitHub Copilot mode requires the GitHub Copilot extension. External AI providers require user-provided credentials, stored in VS Code SecretStorage when configured through Intelli Git commands.

## Usage

Open the Intelli Git activity bar view to review local changes, organize files, create commits, and push changes.

The extension supports two commit panel modes:

- `staged`: follows the normal Git staged and unstaged model
- `changes`: uses IntelliJ-style changelists and commits only the active changelist

You can switch the mode from VS Code Settings with `intelli-git.changelist.mode`.

## AI Provider Setup

Run `Intelli: Configure AI Provider` from the Command Palette to choose a provider and configure credentials.

API keys are stored with VS Code SecretStorage. Legacy settings-based API keys are migrated and cleared automatically when possible.

## Privacy

Intelli Git runs locally inside VS Code and reads Git repository state from the workspace you open.

When AI commit message generation is used, selected diff context may be sent to the configured AI provider. No AI request is made unless you invoke an AI action.

## Known Limitations

- Changelist behavior is implemented by the extension and is not a native Git concept.
- Some operations depend on the current repository state and may be blocked by merge conflicts or unsupported Git states.
- AI output quality depends on the selected provider and model.

## Support

For support and issue reporting, see `SUPPORT.md`.

## License

Proprietary License. See `LICENSE` for details.
