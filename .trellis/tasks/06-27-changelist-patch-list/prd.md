# Add changelist patch export submenu

## Goal

Let users export a Git patch from changelist tree nodes and make Git Log file patch export use the same native submenu interaction.

## Requirements

- Do not implement a persistent patch list, patch shelf, or patch preview in this task.
- Add a native webview context submenu labeled `Create Patch` for changelist root, folder, and file nodes in changelist mode and staged mode.
- The `Create Patch` submenu must contain exactly these export actions:
  - `Copy to Clipboard`
  - `Save to File...`
- Changelist root export must generate a patch for that changelist.
- Changelist folder and file export must generate a patch scoped to the selected folder or file while preserving the selected changelist's hunk assignments.
- Staged mode root, folder, and file export must generate a patch for the selected staged/unstaged/untracked group without mixing staged and unstaged hunks.
- Patch generation must not temporarily switch the active changelist or mutate the user's real Git index.
- Git Log file context menus must use the same `Create Patch` submenu shape instead of the current QuickPick interaction.
- User-facing command titles and messages must be localized.

## Acceptance Criteria

- [x] Right-clicking a changelist root in changelist mode shows `Create Patch > Copy to Clipboard` and `Create Patch > Save to File...`.
- [x] Right-clicking a changelist folder in changelist mode shows the same submenu and exports only the folder's assigned changes.
- [x] Right-clicking a changelist file in changelist mode shows the same submenu and exports only that file's assigned changes.
- [x] Generated changelist patches preserve hunk-level assignments when the same file is split across changelists.
- [x] Right-clicking a staged mode `Staged Changes`, `Changes`, or `Untracked Changes` root/folder/file shows the same submenu and exports only that group's changes.
- [x] Right-clicking a Git Log file shows the same `Create Patch` submenu actions.
- [x] Git Log patch export no longer opens a QuickPick from the context-menu path.
- [x] Empty patch targets show the existing no-changes feedback instead of writing an empty file or clipboard value.

## Out of Scope

- Persistent patch list view.
- Patch preview/open editor flow.
- Applying, dropping, or managing saved patch entries.

## Notes

- The issue originally mentions a stash-like patch list view, but the agreed first scope is export-only context menu support.
