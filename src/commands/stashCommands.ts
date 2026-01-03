import * as vscode from 'vscode';
import { GitService } from '../services/GitService';
import { CommitViewProvider } from '../providers/CommitViewProvider';

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
                provider.refresh();
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.stashApply', async (args: any) => {
            if (args && typeof args.stashIndex === 'number') {
                await gitService.applyStash(args.stashIndex);
                provider.refresh();
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.stashDrop', async (args: any) => {
            if (args && typeof args.stashIndex === 'number') {
                const confirm = await vscode.window.showWarningMessage(
                    vscode.l10n.t('Drop stash@{{{0}}}?', args.stashIndex),
                    { modal: true },
                    vscode.l10n.t('Drop')
                );
                if (confirm) {
                    await gitService.dropStash(args.stashIndex);
                    provider.refresh();
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.stashShowDiff', async (args: any) => {
            if (args && typeof args.stashIndex === 'number') {
                const files = await gitService.getStashFiles(args.stashIndex);
                if (files.length === 0) {
                    vscode.window.showInformationMessage('No files in this stash.');
                    return;
                }

                const filePath = args.selectedStashFile || files[0].path;

                const stashRef = `stash@{${args.stashIndex}}`;
                const parentRef = `${stashRef}^`;
                const leftUri = vscode.Uri.parse(`intelli-git-stash://stash/${encodeURIComponent(parentRef)}/${filePath}`).with({
                    query: JSON.stringify({ ref: parentRef, path: filePath })
                });
                const rightUri = vscode.Uri.parse(`intelli-git-stash://stash/${encodeURIComponent(stashRef)}/${filePath}`).with({
                    query: JSON.stringify({ ref: stashRef, path: filePath })
                });

                await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, `${filePath} (Stash@{${args.stashIndex}})`, {
                    preview: true,
                    viewColumn: vscode.ViewColumn.Active
                });
            }
        })
    );
}
