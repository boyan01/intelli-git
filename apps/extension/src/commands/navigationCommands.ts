import * as vscode from 'vscode';
import { GitService } from '../services/GitService';
import { BranchStatusBar } from '../ui/BranchStatusBar';
import { CommitViewProvider } from '../providers/CommitViewProvider';
import { GitLogViewProvider } from '../providers/GitLogViewProvider';

/**
 * Register navigation and branch-related commands
 */
export function registerNavigationCommands(
    context: vscode.ExtensionContext,
    gitService: GitService,
    branchStatusBar: BranchStatusBar,
    gitLogProvider: GitLogViewProvider,
    commitViewProvider: CommitViewProvider
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.refresh', () => {
            branchStatusBar.update();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.push', () => {
            commitViewProvider.showPushTab();
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
        vscode.commands.registerCommand('intelli-git.openFeedback', async () => {
            await vscode.env.openExternal(vscode.Uri.parse('https://github.com/boyan01/intelli-git-feedback/issues/new/choose'));
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
        vscode.commands.registerCommand('intelli-git.focusGitLog', () => {
            if (gitLogProvider.isVisible()) {
                vscode.commands.executeCommand('workbench.action.togglePanel');
            } else {
                vscode.commands.executeCommand('intelli-git.logView.focus');
            }
        })
    );
}
