import * as vscode from 'vscode';
import { CommitViewProvider } from './CommitViewProvider';
import { PushPanel } from './PushPanel';
import { GitService } from './GitService';
import { BranchStatusBar } from './BranchStatusBar';

export function activate(context: vscode.ExtensionContext) {
    console.log('IDEA Commit Panel is now active!');

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (!workspaceRoot) {
        vscode.window.showWarningMessage('IDEA Commit Panel: No workspace opened.');
        return;
    }

    const gitService = new GitService(workspaceRoot);
    const provider = new CommitViewProvider(context.extensionUri);
    const branchStatusBar = new BranchStatusBar(gitService);

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

    context.subscriptions.push(branchStatusBar);

    // Listen for workspace folder changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            branchStatusBar.update();
        })
    );
}

export function deactivate() {}
