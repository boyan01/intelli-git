# Implementation Plan

## Checklist

- [x] Read pre-development specs with `trellis-before-dev` before editing source files.
- [x] Extend `ChangelistStateService.buildCommitPlan(...)` with an optional `targetListId` parameter and keep existing active-list behavior as the default.
- [x] Add focused tests proving a non-active changelist can produce a plan and split-file hunks are excluded correctly.
- [x] Add changelist patch export helpers/commands in `changelistCommands.ts`:
  - resolve root/folder/file context
  - build a changelist-scoped patch through the temporary-index diff path
  - copy the patch to clipboard
  - save the patch to file
- [x] Add staged mode patch export for `Staged Changes`, `Changes`, and `Untracked Changes` root/folder/file nodes without mixing staged and unstaged hunks.
- [x] Replace Git Log context menu patch QuickPick with direct submenu commands:
  - copy to clipboard
  - save to file
- [x] Update `apps/extension/package.json`:
  - add `intelli-git.createPatch` submenu contribution
  - add contributed commands for changelist and Git Log copy/save actions
  - add submenu entries under `webview/context`
  - remove the old direct Git Log context menu entry from webview context
- [x] Update `apps/extension/package.nls.json` and `apps/extension/package.nls.zh-cn.json`.
- [x] Verify no patch list, preview, or apply/drop behavior was added.

## Validation

- [x] `npm run compile --workspace intelli-git`
- [x] `npm run test --workspace intelli-git`
- [x] `npm run lint`
- [x] `git diff --check`

## Risk Points

- Folder/root contexts only carry paths, not hunk maps. The implementation must combine `targetListId` with paths rather than generating raw path diffs.
- Git Log existing command-palette behavior may still use the old command. The required user-facing context-menu path must be submenu-based.
- Package contribution changes can break command registration tests if new commands are not listed consistently.
