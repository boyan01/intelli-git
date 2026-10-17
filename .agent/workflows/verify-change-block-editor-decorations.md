# Verify Change Block Editor Decorations

Use this checklist when changing Intelli Git editor or diff change block labels, context actions, or hunk-to-changelist resolution.

1. Start the extension host from VS Code and open a repository with tracked changes.
2. In `staged` mode, open a changed file and verify Intelli Git shows no change block labels, status bar item, or change block actions.
3. Switch to `changes` mode, move one block to a non-default changelist, and verify the label uses the changelist name while default changelist blocks stay quiet.
4. Use the status bar action, editor context menu, and lightbulb action on the same block; verify all operate on the same change block.
5. Use `Reveal in Commit Panel` and verify the commit panel focuses the corresponding file.
6. Toggle `intelli-git.editor.changeBlockDecorations` between `off`, `diffOnly`, and `allEditors`; verify decorations appear only for the configured scope.
7. Run `npm run compile` and the relevant unit/regression tests before publishing.
