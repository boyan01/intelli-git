import * as vscode from 'vscode';
import { GitService } from '../services/GitService';

export function registerLogCommands(
    context: vscode.ExtensionContext,
    gitService: GitService
) {
    const commitMessageEditorFiles = new Set<string>();
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider({ scheme: 'file' }, {
            provideCodeLenses(document) {
                if (!commitMessageEditorFiles.has(document.uri.fsPath)) {
                    return [];
                }

                return [
                    new vscode.CodeLens(
                        new vscode.Range(0, 0, 0, 0),
                        {
                            title: vscode.l10n.t('Save (Cmd+S) to apply · Close to cancel'),
                            command: 'workbench.action.files.save'
                        }
                    )
                ];
            }
        })
    );

    const getCommitHash = (arg: any): string | undefined => {
        if (!arg) return undefined;
        if (arg.webviewSection === 'gitLogCommit' && arg.hash) return arg.hash;
        // Fallback or other contexts
        if (arg.hash) return arg.hash;
        return undefined;
    };

    const confirmAction = async (message: string, action: string) => {
        const result = await vscode.window.showWarningMessage(message, { modal: true }, action);
        return result === action;
    };

    // Reset Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.log.resetSoft', async (arg) => {
            const hash = getCommitHash(arg);
            if (!hash) return;
            if (await confirmAction(vscode.l10n.t('Reset current branch to {0} (Soft)?\nChanges will be staged.', hash), vscode.l10n.t('Reset'))) {
                try {
                    await gitService.branchRemote.reset('soft', hash);
                    vscode.window.showInformationMessage(vscode.l10n.t('Soft reset successful.'));
                } catch (e: any) {
                    vscode.window.showErrorMessage(vscode.l10n.t('Reset failed: {0}', e.message));
                }
            }
        }),
        vscode.commands.registerCommand('intelli-git.log.resetMixed', async (arg) => {
            const hash = getCommitHash(arg);
            if (!hash) return;
            if (await confirmAction(vscode.l10n.t('Reset current branch to {0} (Mixed)?\nChanges will be unstaged.', hash), vscode.l10n.t('Reset'))) {
                try {
                    await gitService.branchRemote.reset('mixed', hash);
                    vscode.window.showInformationMessage(vscode.l10n.t('Mixed reset successful.'));
                } catch (e: any) {
                    vscode.window.showErrorMessage(vscode.l10n.t('Reset failed: {0}', e.message));
                }
            }
        }),
        vscode.commands.registerCommand('intelli-git.log.resetHard', async (arg) => {
            const hash = getCommitHash(arg);
            if (!hash) return;
            if (await confirmAction(vscode.l10n.t('Reset current branch to {0} (Hard)?\nALL LOCAL CHANGES WILL BE LOST.', hash), vscode.l10n.t('Reset Hard'))) {
                try {
                    await gitService.branchRemote.reset('hard', hash);
                    vscode.window.showInformationMessage(vscode.l10n.t('Hard reset successful.'));
                } catch (e: any) {
                    vscode.window.showErrorMessage(vscode.l10n.t('Reset failed: {0}', e.message));
                }
            }
        })
    );

    // Checkout
    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.log.checkout', async (arg) => {
            const hash = getCommitHash(arg);
            if (!hash) return;
            if (await confirmAction(vscode.l10n.t('Checkout commit {0}? You will be in detached HEAD state.', hash), vscode.l10n.t('Checkout'))) {
                try {
                    await gitService.branchRemote.checkoutCommit(hash);
                    vscode.window.showInformationMessage(vscode.l10n.t('Checked out {0}', hash));
                } catch (e: any) {
                    vscode.window.showErrorMessage(vscode.l10n.t('Checkout failed: {0}', e.message));
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.log.openOnGitHub', async (arg) => {
            const hash = getCommitHash(arg);
            if (!hash) return;

            try {
                const repositoryUrl = await gitService.branchRemote.getGitHubRepositoryUrl();
                if (!repositoryUrl) {
                    vscode.window.showInformationMessage(vscode.l10n.t('No GitHub remote found for this repository.'));
                    return;
                }

                await vscode.env.openExternal(vscode.Uri.parse(`${repositoryUrl}/commit/${hash}`));
            } catch (e: any) {
                vscode.window.showErrorMessage(vscode.l10n.t('Failed to open commit on GitHub: {0}', e.message));
            }
        })
    );

    // Create Branch
    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.log.createBranch', async (arg) => {
            const hash = getCommitHash(arg);
            if (!hash) return;

            const branchName = await vscode.window.showInputBox({
                prompt: vscode.l10n.t('Create new branch at {0}', hash),
                placeHolder: vscode.l10n.t('Branch name')
            });

            if (branchName) {
                try {
                    await gitService.branchRemote.createBranchFrom(branchName, hash);
                    vscode.window.showInformationMessage(vscode.l10n.t('Created branch {0} at {1}', branchName, hash));
                } catch (e: any) {
                    vscode.window.showErrorMessage(vscode.l10n.t('Failed to create branch: {0}', e.message));
                }
            }
        })
    );

    // Cherry Pick
    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.log.cherryPick', async (arg) => {
            const hash = getCommitHash(arg);
            if (!hash) return;

            if (await confirmAction(vscode.l10n.t('Cherry-pick commit {0}?', hash), vscode.l10n.t('Cherry-pick'))) {
                try {
                    await gitService.branchRemote.cherryPick(hash);
                    vscode.window.showInformationMessage(vscode.l10n.t('Cherry-picked {0}', hash));
                } catch (e: any) {
                    vscode.window.showErrorMessage(vscode.l10n.t('Cherry-pick failed: {0}', e.message));
                }
            }
        })
    );

    // Revert
    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.log.revert', async (arg) => {
            const hash = getCommitHash(arg);
            if (!hash) return;

            if (await confirmAction(vscode.l10n.t('Revert commit {0}?', hash), vscode.l10n.t('Revert'))) {
                try {
                    await gitService.branchRemote.revert(hash);
                    vscode.window.showInformationMessage(vscode.l10n.t('Reverted {0}', hash));
                } catch (e: any) {
                    vscode.window.showErrorMessage(vscode.l10n.t('Revert failed: {0}', e.message));
                }
            }
        })
    );

    // Undo Commit (reset --soft to parent)
    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.log.undoCommit', async (arg) => {
            const hash = getCommitHash(arg);
            if (!hash) return;

            // Check if commit is pushed to remote
            const isPushed = await gitService.branchRemote.isCommitPushed(hash);
            if (isPushed) {
                vscode.window.showWarningMessage(
                    vscode.l10n.t('Cannot undo commit {0}: it has already been pushed to remote.', hash)
                );
                return;
            }

            if (await confirmAction(
                vscode.l10n.t('Undo commit {0}?\n\nThe changes will be kept in your working directory.', hash),
                vscode.l10n.t('Undo Commit')
            )) {
                try {
                    // Reset to parent commit, keeping changes staged
                    await gitService.branchRemote.reset('soft', `${hash}~1`);
                    vscode.window.showInformationMessage(vscode.l10n.t('Commit {0} undone. Changes are now staged.', hash));
                } catch (e: any) {
                    vscode.window.showErrorMessage(vscode.l10n.t('Undo commit failed: {0}', e.message));
                }
            }
        })
    );

    // Edit Commit Message (reword)
    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.log.editMessage', async (arg) => {
            const hash = getCommitHash(arg);
            if (!hash) return;

            const fs = await import('fs');
            const os = await import('os');
            const path = await import('path');

            // Get current commit message
            const currentMessage = await gitService.getCommitMessage(hash);
            const shortHash = hash.substring(0, 7);

            const tempDir = os.tmpdir();
            const tempFile = path.join(tempDir, `COMMIT_EDITMSG-${shortHash}-${Date.now()}.txt`);
            fs.writeFileSync(tempFile, currentMessage, 'utf8');
            commitMessageEditorFiles.add(tempFile);

            const tempUri = vscode.Uri.file(tempFile);
            const doc = await vscode.workspace.openTextDocument(tempUri);
            await vscode.window.showTextDocument(doc, { preview: false });

            let applied = false;

            const saveDisposable = vscode.workspace.onDidSaveTextDocument(async savedDoc => {
                if (savedDoc.uri.fsPath !== tempFile || applied) return;

                const newMessage = savedDoc.getText().trim();
                if (!newMessage) {
                    vscode.window.showWarningMessage(vscode.l10n.t('Commit message cannot be empty.'));
                    return;
                }

                if (newMessage === currentMessage) {
                    vscode.window.showInformationMessage(vscode.l10n.t('No changes detected.'));
                    return;
                }

                applied = true;
                try {
                    await gitService.rewordCommit(hash, newMessage);
                } catch (e: any) {
                    applied = false;
                    vscode.window.showErrorMessage(vscode.l10n.t('Failed to edit commit message: {0}', e.message));
                }
            });

            const closeDisposable = vscode.workspace.onDidCloseTextDocument(closedDoc => {
                if (closedDoc.uri.fsPath !== tempFile) return;

                saveDisposable.dispose();
                closeDisposable.dispose();
                commitMessageEditorFiles.delete(tempFile);
                try { fs.unlinkSync(tempFile); } catch { /* ignore */ }
            });

            context.subscriptions.push(saveDisposable, closeDisposable);
        })
    );
}
