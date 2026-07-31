# Changelog

## 0.0.8

- Added an opt-in experimental three-way merge editor with per-change review, editable results, and dedicated binary and submodule conflict actions.
- Added conflict resolution support for marker-free manually resolved files directly from the commit view.
- Improved commit view responsiveness by coalescing repeated refreshes and preserving visible content during background validation.
- Prevented remote fetch and push operations from blocking local Git status reads, and disabled Intelli Git background fetches by default.
- Extended the Early Access build lifetime from 30 days to 180 days, with expiration warnings limited to the final seven days.

## 0.0.7

- Added Create Patch submenu actions for changelist, staged, unstaged, and untracked tree nodes.
- Improved Git operation safety by serializing repository-scoped write actions such as commit, stash, checkout, rebase, merge, and reset.
- Improved parent repository handling for subdirectory workspaces by detecting unopened parent Git roots and offering explicit setup actions.

## 0.0.6

- Added worktree-aware repository switching and repository controls for multi-root and worktree-based projects.
- Added multi-repository commit view support so commit operations stay scoped to the selected repository.
- Added safer branch, checkout, rebase, and reset workflows that preview destructive operations and protect dirty worktrees.
- Added protected-branch push warnings and a native review branch publish flow.
- Added background origin fetches and clearer branch status indicators.
- Improved Push tab target selection, empty states, danger states, refresh stability, and operation error reporting.
- Improved Git Log loading performance for large repositories and refined narrow-layout commit details.
- Improved AI commit message generation with provider status, scoped generation, and clearer configuration controls.
- Improved webview loading feedback with delayed top progress bars instead of blocking spinners.
- Added Open VSX packaging support alongside Marketplace release packaging.

## 0.0.5

- Added Early Access messaging that clarifies Intelli Git is currently free.
- Updated expiration warnings to use Early Access wording.
- Added repository switching support for multi-root workspaces.
- Added keyboard navigation for webview trees and Git Log filter menus.
- Added branch log filtering, visible Git Log filter summaries, and inline Git Log details for narrow layouts.
- Improved commit view empty states, background mode switching, and split indicators for files spread across changelists.
- Improved branch and push workflow reliability around remotes and subdirectory merge states.
- Simplified commit empty states by removing redundant quick actions.

## 0.0.4

- Added a native commit mode menu in the commit view title bar with clear staged and changelist mode switching.
- Added editor change-block decorations and actions for staged, inactive, and changelist-specific changes.
- Improved staged mode drag and drop with clearer drop targets and better auto-scroll behavior.
- Added configurable AI commit message prompts.
- Added public feedback and issue-reporting entry points.
- Improved Intelli Git diagnostics formatting for easier local review and sharing.
- Fixed full commit message preservation in amend and push commit editing workflows.
- Fixed staged and changelist commit planning so partial staging, untracked files, inactive blocks, and changelist assignments are preserved more reliably.
- Fixed whole-file editor decorations for deleted and untracked files.

## 0.0.3

- Improved tree navigation with sticky section headers across commit, Git log, stash, and push views.
- Added compact single-child folder rendering in the commit tree.
- Added context menu actions for latest unpushed commits in the push workflow.
- Fixed rebase editor flows so Git environment isolation no longer breaks editor handoff.
- Fixed changelist tree actions for inactive files.
- Improved Marketplace discoverability with clearer JetBrains, IntelliJ IDEA, commit panel, changelist, stash, and Git log metadata.

## 0.0.2

- Fixed Marketplace display name and description metadata.

## 0.0.1

- Initial Marketplace release.
- Added IntelliJ-style commit panel workflow for VS Code.
- Added staged and changelist-based commit modes.
- Added inactive changes support.
- Added Git log, branch, stash, and push actions.
- Added AI-assisted commit message generation with configurable providers.
