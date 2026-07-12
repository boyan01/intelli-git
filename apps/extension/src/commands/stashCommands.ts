import * as vscode from 'vscode';
import { GitService } from '../services/GitService';
import { CommitViewProvider } from '../providers/CommitViewProvider';
import { createStashContentUri } from '../utils/repositoryContentUri';

/**
 * Register stash-related commands
 */
export function registerStashCommands(
    context: vscode.ExtensionContext,
    gitService: GitService,
    provider: CommitViewProvider
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.stashPop', async (args: any) => {
            if (args && typeof args.stashIndex === 'number') {
                await gitService.popStash(args.stashIndex);
                provider.requestRefresh({ scopes: ['commit', 'stash'], reason: 'stash-popped' });
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.stashApply', async (args: any) => {
            if (args && typeof args.stashIndex === 'number') {
                await gitService.applyStash(args.stashIndex);
                provider.requestRefresh({ scopes: ['commit'], reason: 'stash-applied' });
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.stashDrop', async (args: any) => {
            if (args && typeof args.stashIndex === 'number') {
                const stashRef = `stash@{${args.stashIndex}}`;
                const confirm = await vscode.window.showWarningMessage(
                    vscode.l10n.t('Drop {0}?', stashRef),
                    { modal: true },
                    vscode.l10n.t('Drop')
                );
                if (confirm) {
                    await gitService.dropStash(args.stashIndex);
                    provider.requestRefresh({ scopes: ['stash'], reason: 'stash-dropped' });
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.stashShowDiff', async (args: any) => {
            if (args && typeof args.stashIndex === 'number') {
                const files = await gitService.getStashFiles(args.stashIndex);
                if (files.length === 0) {
                    vscode.window.showInformationMessage(vscode.l10n.t('No files in this stash.'));
                    return;
                }

                const filePath = args.selectedStashFile || files[0].path;

                const stashRef = `stash@{${args.stashIndex}}`;
                const parentRef = `${stashRef}^`;
                const leftUri = createStashContentUri(gitService, parentRef, filePath);
                const rightUri = createStashContentUri(gitService, stashRef, filePath);

                await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, `${filePath} (Stash@{${args.stashIndex}})`, {
                    preview: true,
                    viewColumn: vscode.ViewColumn.Active
                });
            }
        })
    );
}
