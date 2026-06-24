# Fix parent repository SCM integration design

## Summary

Add an extension-host integration that detects when Intelli Git has resolved a parent Git root for an opened subdirectory, but VS Code's built-in Git extension has not opened that parent repository. In that case, show one localized recovery prompt with an action that invokes VS Code's `git.openRepositoriesInParentFolders` command.

## Boundaries

- Keep repository discovery owned by `RepositoryManager`.
- Keep Git path scoping owned by `GitService`; do not change `toRepoPath()` / `toWorkspacePath()` semantics.
- Add VS Code Git integration behavior in extension-host service code, not webview UI.
- Do not add Intelli Git-owned Explorer/editor decorations.
- Do not silently change `git.openRepositoryInParentFolders` or any user setting.

## Data flow

1. `RepositoryManager` scans repositories as today.
2. Activation wiring listens for repository list / active repository changes.
3. The integration checks each Intelli Git repository scope where `scope.gitRoot !== scope.workspaceRoot`.
4. It activates the built-in Git extension API and compares `api.repositories[*].rootUri.fsPath` with `scope.gitRoot`.
5. If VS Code Git already has that root open, no UI is shown.
6. If VS Code Git does not have that root open, Intelli Git shows a localized warning:
   - Primary action: open parent repositories through `git.openRepositoriesInParentFolders`.
   - Secondary action: open the VS Code setting for `git.openRepositoryInParentFolders`.
7. After the primary action runs, trigger repository refresh context updates through the existing repository/watch flow where possible.

## User experience

The prompt should appear only for the split-brain case:

```text
VS Code opened:   project-a/backend
Intelli Git root: project-a
VS Code Git root: not opened
```

Suggested message:

```text
Intelli Git detected a Git repository in a parent folder, but VS Code Git has not opened it. Open the parent repository to enable Source Control decorations.
```

Actions:

- `Open Parent Repository`
- `Open Git Setting`

## Compatibility

- Normal root-opened repository: skipped because `gitRoot === workspaceRoot`.
- Multi-root workspace: check every Intelli Git repository scope independently; de-duplicate by `gitRoot`.
- Submodules: skipped unless their `gitRoot` differs from their workspace root, because submodules are normal repository roots in existing discovery.
- Worktrees: skip linked worktrees where `gitRoot === workspaceRoot`; do not change worktree discovery.
- Older or unavailable VS Code Git API: fail closed with no prompt; Intelli Git must continue working.

## State and prompt frequency

Use in-memory prompt suppression per `gitRoot` for the extension session. Do not persist dismissal yet; users who keep the split-brain state after reload should still receive a recovery path.

Avoid repeated prompts by tracking roots currently prompted or already acknowledged during the session. If `git.openRepositoriesInParentFolders` succeeds and VS Code Git later opens the repository, clear any pending prompt state through the next check.

## Testing strategy

- Unit-test the detection logic with mocked VS Code Git repositories.
- Cover:
  - root repository is skipped
  - parent repository missing from VS Code Git returns a prompt candidate
  - parent repository present in VS Code Git returns no prompt
  - duplicate Intelli Git scopes under one parent root produce one prompt
- Keep existing `GitService repository scope` test intact.
- Run `npm run compile --workspace intelli-git`.
- Run focused extension tests, then broader extension tests if time permits.

## Risks

- `git.openRepositoriesInParentFolders` is a VS Code command, not an Intelli Git API. Guard it with best-effort execution and a fallback settings action.
- VS Code Git repository detection can be asynchronous. Run checks after repository manager initialization and after repository changes, with debounce or in-flight suppression if needed.
- Prompt spam would be worse than silent behavior. De-duplicate aggressively by `gitRoot`.
