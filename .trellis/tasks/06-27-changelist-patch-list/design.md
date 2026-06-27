# Design: Changelist patch export submenu

## Scope

This task adds export-only patch creation. It does not add patch preview, persistent patch storage, or patch apply/drop workflows.

## Context menu shape

Add a contributed submenu:

- submenu id: `intelli-git.createPatch`
- label: `Create Patch`

Add this submenu to `webview/context` for:

- `changelistRoot`, `changelistFolder`, and `changelistFile` when `changelistMode == 'changes'` or `changelistMode == 'staged'`, excluding inactive changes and conflicts
- `gitLogCommitFile`

Populate the submenu with direct commands instead of QuickPick:

- `Copy to Clipboard`
- `Save to File...`

Use separate command ids for changelist and Git Log sources so each existing command module can own its own target resolution:

- `intelli-git.changelist.createPatch.copy`
- `intelli-git.changelist.createPatch.save`
- `intelli-git.log.file.createPatch.copy`
- `intelli-git.log.file.createPatch.save`

The old `intelli-git.log.file.createPatch` QuickPick command is removed so Git Log patch export has only the submenu interaction.

## Changelist patch generation

Changelist export must not use raw `git diff -- <paths>` because that would include hunks assigned to other changelists when a file is split.

Use the existing temporary-index path:

1. Load current Git status with hunks.
2. Sync inactive changes and changelist assignments with the current status.
3. Build a commit-style plan for the target changelist id and optional selected paths.
4. Generate a cached diff from the plan through `GitService.getDiffForChangelistPlan(...)`.

`ChangelistStateService.buildCommitPlan(...)` currently targets `activeListId`. Extend it with an optional `targetListId` parameter that defaults to `activeListId`, preserving current commit and AI-generation behavior.

Folder and file nodes pass `paths` from their existing `data-vscode-context`; root nodes pass the changelist id with the full root path list. The plan builder combines `targetListId` and `requestedFiles` so the exported patch is both subtree-scoped and changelist-scoped.

## Staged mode patch generation

Staged mode uses the tree group id from `data-vscode-context`:

- `staged-changes`: generate `git diff --cached -- <paths>` through `GitService.getStagedDiffForFiles(...)`
- `changes`: generate an unstaged-only worktree diff through `GitService.getUnstagedDiffForFiles(...)`
- `untracked-changes`: use the same unstaged-only path, including manually generated new-file patches for untracked files

Do not use `git diff HEAD -- <paths>` for the unstaged group because it would include indexed changes from files that have both staged and unstaged hunks.

## Git Log patch generation

Reuse the existing Git Log patch content source:

- `gitService.getFileDiff(commitHash, repoPath)`

Replace the context-menu QuickPick path with direct copy/save commands. Keep empty patch feedback identical: `No changes to create patch from.`

## File export behavior

Copy action:

- write the patch string to `vscode.env.clipboard`
- show `Patch copied to clipboard.`

Save action:

- use a default `.patch` filename derived from the target
- show a save dialog filtered to `.patch` and `.diff`
- write the selected file
- show `Patch saved to {0}`

## Localization

Update package nls for contributed submenu and command titles.

Use existing shared l10n entries for runtime messages where present:

- `No changes to create patch from.`
- `Patch copied to clipboard.`
- `Patch saved to {0}`
- `Save Patch`

Add missing entries only if implementation introduces new runtime text.

## Compatibility

- Existing commit execution and AI generation must keep targeting the active changelist because the new `targetListId` parameter defaults to current behavior.
- No webview component changes are expected beyond existing context payloads unless testing reveals missing context data.
