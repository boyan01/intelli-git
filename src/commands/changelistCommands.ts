import * as vscode from 'vscode';
import { GitService } from '../services/GitService';
import { ChangelistService } from '../services/ChangelistService';
import { CommitViewProvider } from '../providers/CommitViewProvider';
import { i18n } from '../utils/i18n';

interface ChangelistFileContext {
    webviewSection: 'changelistFile';
    path: string;
    status?: string;
}

/**
 * Register changelist file-related context menu commands.
 */
export function registerChangelistCommands(
    context: vscode.ExtensionContext,
    gitService: GitService,
    changelistService: ChangelistService,
    provider: CommitViewProvider
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.changelist.openFile', async (args: ChangelistFileContext) => {
            if (args?.path) {
                const workspaceRoot = gitService.getWorkspaceRoot();
                if (workspaceRoot) {
                    const uri = vscode.Uri.file(`${workspaceRoot}/${args.path}`);
                    await vscode.commands.executeCommand('vscode.open', uri);
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.changelist.showDiff', async (args: ChangelistFileContext) => {
            if (args?.path) {
                const workspaceRoot = gitService.getWorkspaceRoot();
                if (workspaceRoot) {
                    const uri = vscode.Uri.file(`${workspaceRoot}/${args.path}`);
                    if (args.status === '?') {
                        // Unversioned file: just open the source file
                        await vscode.commands.executeCommand('vscode.open', uri);
                    } else {
                        await vscode.commands.executeCommand('git.openChange', uri);
                    }
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.changelist.rollback', async (args: ChangelistFileContext) => {
            if (args?.path) {
                const confirm = await vscode.window.showWarningMessage(
                    i18n.t('extension.rollbackFilesConfirm', 1),
                    { modal: true },
                    'Rollback'
                );
                if (confirm === 'Rollback') {
                    try {
                        await gitService.rollbackFiles([args.path]);
                        provider.refresh();
                    } catch (e) {
                        vscode.window.showErrorMessage(i18n.t('extension.rollbackFailed', `${e}`));
                    }
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.changelist.stash', async (args: ChangelistFileContext) => {
            if (args?.path) {
                const message = await vscode.window.showInputBox({
                    placeHolder: i18n.t('extension.stashPlaceholder')
                });
                try {
                    await gitService.stash(message, [args.path]);
                    vscode.window.showInformationMessage(i18n.t('extension.stashSuccess'));
                    provider.refresh();
                } catch (e) {
                    vscode.window.showErrorMessage(i18n.t('extension.stashFailed', `${e}`));
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.changelist.delete', async (args: ChangelistFileContext) => {
            if (args?.path) {
                const confirm = await vscode.window.showWarningMessage(
                    i18n.t('extension.deleteFilesConfirm', 1),
                    { modal: true },
                    'Delete'
                );
                if (confirm === 'Delete') {
                    const workspaceRoot = gitService.getWorkspaceRoot();
                    if (workspaceRoot) {
                        try {
                            const uri = vscode.Uri.file(`${workspaceRoot}/${args.path}`);
                            await vscode.workspace.fs.delete(uri, { recursive: false, useTrash: true });
                            provider.refresh();
                        } catch (e) {
                            vscode.window.showErrorMessage(i18n.t('extension.deleteFailed', `${e}`));
                        }
                    }
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.changelist.moveToChangelist', async (args: ChangelistFileContext) => {
            if (args?.path) {
                const changelists = changelistService.getChangelists();

                const items: vscode.QuickPickItem[] = [
                    { label: '$(add) ' + i18n.t('extension.newChangelistPlaceholder'), description: '' }
                ];

                changelists.forEach(cl => {
                    items.push({
                        label: cl.name,
                        description: `${cl.files.length} files`
                    });
                });

                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: vscode.l10n.t('Move to Changelist...')
                });

                if (selected) {
                    if (selected.label.startsWith('$(add)')) {
                        const newName = await vscode.window.showInputBox({
                            prompt: i18n.t('extension.enterChangelistName'),
                            placeHolder: i18n.t('extension.newChangelistPlaceholder')
                        });
                        if (newName) {
                            const newId = await changelistService.createChangelist(newName);
                            if (newId) {
                                await changelistService.moveFiles([args.path], newId);
                                provider.refresh();
                            }
                        }
                    } else {
                        const target = changelists.find(cl => cl.name === selected.label);
                        if (target) {
                            await changelistService.moveFiles([args.path], target.id);
                            provider.refresh();
                        }
                    }
                }
            }
        })
    );
}
