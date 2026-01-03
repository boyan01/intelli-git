import * as vscode from 'vscode';
import { CommitViewProvider } from './CommitViewProvider';
import { PushPanel } from './PushPanel';
import { GitService } from './services/GitService';
import { BranchStatusBar } from './BranchStatusBar';
import { StashContentProvider } from './StashContentProvider';
import { ChangelistService } from './services/ChangelistService';
import { RevisionContentProvider } from './RevisionContentProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('Intelli Git is now active!');

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (!workspaceRoot) {
        vscode.window.showWarningMessage('Intelli Git: No workspace opened.');
        return;
    }

    const gitService = new GitService(workspaceRoot);
    const changelistService = new ChangelistService(context);
    const provider = new CommitViewProvider(context.extensionUri, gitService, changelistService);
    const branchStatusBar = new BranchStatusBar(gitService);
    const stashContentProvider = new StashContentProvider(gitService);

    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider('intelli-git-stash', stashContentProvider)
    );

    const revisionContentProvider = new RevisionContentProvider(gitService);
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider('intelli-git-revision', revisionContentProvider)
    );

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(CommitViewProvider.viewType, provider)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.refresh', () => {
            branchStatusBar.update();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.push', () => {
            PushPanel.createOrShow(context.extensionUri, gitService);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.showBranchPicker', () => {
            branchStatusBar.showBranchPicker();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.focusCommitView', () => {
            vscode.commands.executeCommand('intelliGitView.focus');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.copyCommitHash', async (args: any) => {
            if (args && args.hash) {
                await vscode.env.clipboard.writeText(args.hash);
            }
        })
    );

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

                // Use the selected file from context if available, otherwise default to first file
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

    context.subscriptions.push(branchStatusBar);

    // Watch for file changes
    const watcher = vscode.workspace.createFileSystemWatcher('**/*');
    let refreshTimeout: NodeJS.Timeout | undefined;

    const triggerRefresh = (uri?: vscode.Uri) => {
        if (uri && (/\/\.git\//.test(uri.path) || uri.path.endsWith('/.git'))) {
            return;
        }

        if (refreshTimeout) {
            clearTimeout(refreshTimeout);
        }
        refreshTimeout = setTimeout(() => {
            provider.refresh();
            branchStatusBar.update();
        }, 200);
    };

    watcher.onDidChange(triggerRefresh);
    watcher.onDidCreate(triggerRefresh);
    watcher.onDidDelete(triggerRefresh);

    context.subscriptions.push(watcher);

    // Listen for workspace folder changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            branchStatusBar.update();
        })
    );
}

export function deactivate() { }
