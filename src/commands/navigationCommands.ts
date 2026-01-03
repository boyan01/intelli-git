import * as vscode from 'vscode';
import { GitService } from '../services/GitService';
import { BranchStatusBar } from '../ui/BranchStatusBar';
import { PushPanel } from '../providers/PushPanel';
import { GitLogViewProvider } from '../providers/GitLogViewProvider';

/**
 * Register navigation and branch-related commands
 */
export function registerNavigationCommands(
    context: vscode.ExtensionContext,
    gitService: GitService,
    branchStatusBar: BranchStatusBar,
    gitLogProvider: GitLogViewProvider
): void {
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
        vscode.commands.registerCommand('intelli-git.focusGitLog', () => {
            if (gitLogProvider.isVisible()) {
                vscode.commands.executeCommand('workbench.action.togglePanel');
            } else {
                vscode.commands.executeCommand('intelli-git.logView.focus');
            }
        })
    );
}
