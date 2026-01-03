import * as vscode from 'vscode';
import { GitService } from '../services/GitService';
import { CommitViewProvider } from '../providers/CommitViewProvider';

export function registerBranchCommands(
    context: vscode.ExtensionContext,
    gitService: GitService,
    provider?: CommitViewProvider
) {
    // Helper to get branch/ref name from arguments
    const getBranchName = (arg: any): string | undefined => {
        if (!arg) return undefined;

        // Handle Tag
        if (arg.webviewSection === 'tag' && arg.tagName) return arg.tagName;

        // Handle Remote Branch: Prefer full name (e.g. origin/main) for referencing
        if (arg.webviewSection === 'remoteBranch' && arg.fullBranchName) return arg.fullBranchName;

        // Handle Local Branch
        if (arg.webviewSection === 'localBranch' && arg.branchName) return arg.branchName;

        // Fallbacks
        if (arg.branchName) return arg.branchName;
        if (arg.name) return arg.name;
        return undefined;
    };

    const getRemoteBranchName = (arg: any): string | undefined => {
        if (!arg) return undefined;
        if (arg.webviewSection === 'remoteBranch' && arg.fullBranchName) return arg.fullBranchName;
        return undefined;
    };

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.branch.checkout', async (arg) => {
            const branch = getBranchName(arg);
            if (!branch) return;

            try {
                if (arg && arg.webviewSection === 'remoteBranch') {
                    // For remote branches, use logic to create tracking branch or checkout detached
                    await gitService.checkoutRemoteBranch(branch); // branch here is full e.g. origin/main
                } else {
                    // Local branch or Tag
                    await gitService.switchBranch(branch);
                }
                vscode.window.showInformationMessage(`Checked out ${branch}`);
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to checkout ${branch}: ${error.message}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.branch.create', async (arg) => {
            const sourceBranch = getBranchName(arg) || (await gitService.getBranches()).current;

            const newBranchName = await vscode.window.showInputBox({
                prompt: `Create new branch from ${sourceBranch}`,
                placeHolder: 'New branch name'
            });

            if (!newBranchName) return;

            try {
                await gitService.createBranchFrom(newBranchName, sourceBranch);
                vscode.window.showInformationMessage(`Created branch ${newBranchName} from ${sourceBranch}`);
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to create branch: ${error.message}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.branch.delete', async (arg) => {
            const branch = getBranchName(arg);
            if (!branch) return;

            const confirm = await vscode.window.showWarningMessage(
                `Are you sure you want to delete branch ${branch}?`,
                { modal: true },
                'Delete'
            );

            if (confirm !== 'Delete') return;

            try {
                await gitService.deleteBranches([branch]);
                vscode.window.showInformationMessage(`Deleted branch ${branch}`);
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to delete branch: ${error.message}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.branch.rename', async (arg) => {
            const oldName = getBranchName(arg);
            if (!oldName) return;

            const newName = await vscode.window.showInputBox({
                prompt: `Rename branch ${oldName} to`,
                value: oldName
            });

            if (!newName || newName === oldName) return;

            try {
                await gitService.renameBranch(oldName, newName);
                vscode.window.showInformationMessage(`Renamed branch ${oldName} to ${newName}`);
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to rename branch: ${error.message}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.branch.merge', async (arg) => {
            const branchToMerge = getBranchName(arg);
            if (!branchToMerge) return;

            try {
                await gitService.merge(branchToMerge);
                vscode.window.showInformationMessage(`Merged ${branchToMerge} into current branch`);
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to merge ${branchToMerge}: ${error.message}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.branch.rebase', async (arg) => {
            const branchToRebaseOnto = getBranchName(arg);
            if (!branchToRebaseOnto) return;

            try {
                await gitService.rebaseOnto(branchToRebaseOnto);
                vscode.window.showInformationMessage(`Rebased current branch onto ${branchToRebaseOnto}`);
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to rebase onto ${branchToRebaseOnto}: ${error.message}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.branch.pull', async (arg) => {
            const remoteBranch = getRemoteBranchName(arg);
            if (!remoteBranch) return;

            const parts = remoteBranch.split('/');
            if (parts.length < 2) return;
            const remote = parts[0];
            const branch = parts.slice(1).join('/');

            try {
                await gitService.pullWithMerge(remote, branch);
                vscode.window.showInformationMessage(`Pulled ${remote}/${branch}`);
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to pull: ${error.message}`);
            }
        })
    );
}
