import * as vscode from 'vscode';
import { GitService } from '../services/GitService';
import { InactiveChangesService } from '../services/InactiveChangesService';
import { CommitViewProvider } from '../providers/CommitViewProvider';
import { i18n } from '../utils/i18n';

interface ChangelistFileContext {
    webviewSection: 'changelistFile';
    path: string;
    status?: string;
    isStaged?: boolean;
    isInactive?: boolean;
    isConflict?: boolean;
}

/**
 * Register changelist file-related context menu commands.
 */
export function registerChangelistCommands(
    context: vscode.ExtensionContext,
    gitService: GitService,
    inactiveChangesService: InactiveChangesService,
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
                        provider.rpc?.refresh();
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
                    provider.rpc?.refresh();
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
                            provider.rpc?.refresh();
                        } catch (e) {
                            vscode.window.showErrorMessage(i18n.t('extension.deleteFailed', `${e}`));
                        }
                    }
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.changelist.markInactive', async (args: ChangelistFileContext) => {
            if (args?.path) {
                await inactiveChangesService.markInactive([args.path]);

                // Keep inactive files out of commit index.
                const status = await gitService.getStatus();
                const target = status.find(file => file.path === args.path);
                if (target?.staged) {
                    await gitService.unstageFile(args.path);
                }

                provider.rpc?.refresh();
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.changelist.markActive', async (args: ChangelistFileContext) => {
            if (args?.path) {
                await inactiveChangesService.markActive([args.path]);
                provider.rpc?.refresh();
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.changelist.stage', async (args: ChangelistFileContext) => {
            if (!args?.path || args.isInactive) {
                return;
            }

            try {
                await gitService.stageFile(args.path);
                provider.rpc?.refresh();
            } catch (e) {
                vscode.window.showErrorMessage(i18n.t('extension.stageFailed', `${e}`));
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.changelist.unstage', async (args: ChangelistFileContext) => {
            if (!args?.path) {
                return;
            }

            try {
                await gitService.unstageFile(args.path);
                provider.rpc?.refresh();
            } catch (e) {
                vscode.window.showErrorMessage(i18n.t('extension.unstageFailed', `${e}`));
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.changelist.acceptCurrent', async (args: ChangelistFileContext) => {
            if (!args?.path || !args.isConflict) {
                return;
            }

            try {
                await gitService.resolveConflict(args.path, 'ours');
                provider.rpc?.refresh();
            } catch (e) {
                vscode.window.showErrorMessage(i18n.t('extension.resolveConflictFailed', `${e}`));
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.changelist.acceptIncoming', async (args: ChangelistFileContext) => {
            if (!args?.path || !args.isConflict) {
                return;
            }

            try {
                await gitService.resolveConflict(args.path, 'theirs');
                provider.rpc?.refresh();
            } catch (e) {
                vscode.window.showErrorMessage(i18n.t('extension.resolveConflictFailed', `${e}`));
            }
        })
    );
}
