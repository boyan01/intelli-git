# Fix parent repository SCM integration

## Goal

When a user opens a subdirectory inside a Git repository, Intelli Git should avoid a split-brain state where Intelli Git detects the parent repository but VS Code's built-in Git integration has not opened the same repository. Users should get consistent Git feedback across Intelli Git, VS Code Source Control, editor decorations, and Explorer colors.

Example:

```text
project-a/
  .git/
  backend/
  frontend/
```

If VS Code opens `project-a/backend`, Intelli Git can discover `project-a` as the Git root, but VS Code may not automatically open parent repositories depending on `git.openRepositoryInParentFolders`.

## Confirmed Facts

- `RepositoryManager.scanRepositories()` scans the opened workspace folders and user-added repository paths.
- `RepositoryManager.resolveRepositoryScope()` calls `git rev-parse --show-toplevel`, so Intelli Git can detect a parent Git root when the opened folder is a repository subdirectory.
- `RepositoryScope.repoPath`, `path`, and `workspaceRoot` are currently based on the opened folder path, while `gitRoot` stores the real Git top-level path.
- `GitService.create()` also resolves `gitRoot` and runs Git commands from that root.
- `GitService.getStatus()` maps repository paths back to workspace-relative paths and filters out files outside the opened subdirectory.
- `VSCodeGitWatcher` consumes VS Code's built-in Git extension repositories but does not currently check whether the Intelli Git active repository is also open in VS Code Git.
- VS Code parent repository behavior is controlled by VS Code itself; a parent repository may require user action before Source Control decorations appear.
- The bundled VS Code Git extension contributes the command `git.openRepositoriesInParentFolders`, and its SCM welcome view uses this command when parent repositories are detected.

## Requirements

- Preserve Intelli Git's current ability to detect a parent Git root when the opened folder is inside a repository.
- Preserve the current scoped view behavior for subdirectory workspaces: opening `backend` should not force unrelated `frontend` files into Intelli Git's commit view.
- Detect when Intelli Git has resolved a parent `gitRoot` that VS Code's built-in Git extension has not opened.
- Surface a clear, localized user-facing recovery path instead of silently showing Intelli Git changes while VS Code decorations remain missing.
- The recovery path may call VS Code's `git.openRepositoriesInParentFolders` command, but only after the user chooses that action.
- The recovery path must respect VS Code ownership of Source Control state; Intelli Git should not implement separate Explorer/editor Git decorations.
- The fix must not regress normal workspace-root repositories, multi-root workspaces, submodules, or linked worktrees.
- Any new user-facing strings must be localized through the existing l10n flow.

## Acceptance Criteria

- [ ] Opening a repository root continues to behave as it does today.
- [ ] Opening a subdirectory inside a parent repository still lets Intelli Git show only changes inside that opened subdirectory.
- [ ] When the parent repository is not opened by VS Code Git, the extension provides a clear action or guidance to align VS Code Git with the parent repository.
- [ ] When VS Code Git already has the parent repository open, no redundant warning or recovery UI is shown.
- [ ] Repository refresh/watch behavior continues to update Intelli Git after file changes and Git operations.
- [ ] Automated coverage verifies the parent-repository detection and non-warning paths where practical.
- [ ] `npm run compile --workspace intelli-git` passes.
- [ ] Relevant extension host tests pass or are updated for the new behavior.

## Out of Scope

- Replacing VS Code's built-in Git decorations with Intelli Git-owned decorations.
- Changing the commit view to show files outside the opened subdirectory by default.
- Changing global user settings silently.
- Reworking repository identity, changelist persistence keys, or inactive changes storage unless required for the integration fix.

## Open Questions

- None blocking. User approved invoking VS Code's `git.openRepositoriesInParentFolders` command from an explicit Intelli Git user action.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
