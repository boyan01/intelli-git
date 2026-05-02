# Verify Change Block Editor Decorations

Use this checklist when changing Intelli Git editor or diff change block labels, context actions, or hunk-to-changelist resolution.

1. Start the extension host from VS Code and open a repository with tracked changes.
2. In `staged` mode, open an unstaged file diff and verify changed blocks show Intelli Git labels only for non-default states in normal editors, and show expected labels in diff-like editors.
3. Stage one file, open the staged diff from Intelli Git, and verify staged change blocks show `Staged`.
4. Mark one change block inactive from the editor context menu and verify the label changes to `Inactive`, the inactive block is excluded from staged operations, and only `Move Change Block to Active` is offered afterward.
5. Switch to `changes` mode, move one block to a non-default changelist, and verify the label uses the changelist name while default changelist blocks stay quiet.
6. Use the status bar action, editor context menu, and lightbulb action on the same block; verify all operate on the same change block.
7. Use `Reveal in Commit Panel` and verify the commit panel focuses the corresponding file.
8. Toggle `intelli-git.editor.changeBlockDecorations` between `off`, `diffOnly`, and `allEditors`; verify decorations appear only for the configured scope.
9. Run `npm run compile` and the relevant unit/regression tests before publishing.
