import * as vscode from 'vscode';
import { CommitViewProvider } from './CommitViewProvider';
import { PushPanel } from './PushPanel';
import { GitService } from './GitService';
import { BranchStatusBar } from './BranchStatusBar';
import { StashContentProvider } from './StashContentProvider';
import { ChangelistService } from './ChangelistService';
import { DeletedFileDecorationProvider } from './DeletedFileDecorationProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('IDEA Commit Panel is now active!');

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (!workspaceRoot) {
        vscode.window.showWarningMessage('IDEA Commit Panel: No workspace opened.');
        return;
    }

    const gitService = new GitService(workspaceRoot);
    const changelistService = new ChangelistService(context);
    const provider = new CommitViewProvider(context.extensionUri, gitService, changelistService);
    const branchStatusBar = new BranchStatusBar(gitService);
    const stashContentProvider = new StashContentProvider(gitService);

    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider('idea-stash', stashContentProvider)
    );

    context.subscriptions.push(
        vscode.window.registerFileDecorationProvider(new DeletedFileDecorationProvider())
    );

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(CommitViewProvider.viewType, provider)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('idea-commit-panel.refresh', () => {
            provider.refresh();
            branchStatusBar.update();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('idea-commit-panel.push', () => {
            PushPanel.createOrShow(context.extensionUri, gitService);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('idea-commit-panel.showBranchPicker', () => {
            branchStatusBar.showBranchPicker();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('idea-commit-panel.focusCommitView', () => {
            vscode.commands.executeCommand('ideaCommitView.focus');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('idea-commit-panel.switchTabCommit', () => {
             provider.switchTab('commit');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('idea-commit-panel.switchTabStash', () => {
             provider.switchTab('stash');
        })
    );

    context.subscriptions.push(branchStatusBar);

    // Watch for file changes
    const watcher = vscode.workspace.createFileSystemWatcher('**/*');
    let refreshTimeout: NodeJS.Timeout | undefined;

    const triggerRefresh = () => {
        if (refreshTimeout) {
            clearTimeout(refreshTimeout);
        }
        refreshTimeout = setTimeout(() => {
            provider.refresh();
            branchStatusBar.update();
        }, 200); // Debounce for 2 seconds
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

export function deactivate() {}
