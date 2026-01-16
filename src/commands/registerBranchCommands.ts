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
                vscode.window.showInformationMessage(vscode.l10n.t('Checked out {0}', branch));
            } catch (error: any) {
                vscode.window.showErrorMessage(vscode.l10n.t('Failed to checkout {0}: {1}', branch, error.message));
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.branch.create', async (arg) => {
            const sourceBranch = getBranchName(arg) || (await gitService.getBranches()).current;

            const newBranchName = await vscode.window.showInputBox({
                prompt: vscode.l10n.t('Create new branch from {0}', sourceBranch),
                placeHolder: vscode.l10n.t('New branch name')
            });

            if (!newBranchName) return;

            try {
                await gitService.createBranchFrom(newBranchName, sourceBranch);
                vscode.window.showInformationMessage(vscode.l10n.t('Created branch {0} from {1}', newBranchName, sourceBranch));
            } catch (error: any) {
                vscode.window.showErrorMessage(vscode.l10n.t('Failed to create branch: {0}', error.message));
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.branch.delete', async (arg) => {
            const branch = getBranchName(arg);
            if (!branch) return;

            const confirm = await vscode.window.showWarningMessage(
                vscode.l10n.t('Are you sure you want to delete branch {0}?', branch),
                { modal: true },
                vscode.l10n.t('Delete')
            );

            if (confirm !== vscode.l10n.t('Delete')) return;

            try {
                await gitService.deleteBranches([branch]);
                vscode.window.showInformationMessage(vscode.l10n.t('Deleted branch {0}', branch));
            } catch (error: any) {
                vscode.window.showErrorMessage(vscode.l10n.t('Failed to delete branch: {0}', error.message));
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.branch.rename', async (arg) => {
            const oldName = getBranchName(arg);
            if (!oldName) return;

            const newName = await vscode.window.showInputBox({
                prompt: vscode.l10n.t('Rename branch {0} to', oldName),
                value: oldName
            });

            if (!newName || newName === oldName) return;

            try {
                await gitService.renameBranch(oldName, newName);
                vscode.window.showInformationMessage(vscode.l10n.t('Renamed branch {0} to {1}', oldName, newName));
            } catch (error: any) {
                vscode.window.showErrorMessage(vscode.l10n.t('Failed to rename branch: {0}', error.message));
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.branch.merge', async (arg) => {
            const branchToMerge = getBranchName(arg);
            if (!branchToMerge) return;

            try {
                await gitService.merge(branchToMerge);
                vscode.window.showInformationMessage(vscode.l10n.t('Merged {0} into current branch', branchToMerge));
            } catch (error: any) {
                vscode.window.showErrorMessage(vscode.l10n.t('Failed to merge {0}: {1}', branchToMerge, error.message));
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.branch.rebase', async (arg) => {
            const branchToRebaseOnto = getBranchName(arg);
            if (!branchToRebaseOnto) return;

            try {
                await gitService.rebaseOnto(branchToRebaseOnto);
                vscode.window.showInformationMessage(vscode.l10n.t('Rebased current branch onto {0}', branchToRebaseOnto));
            } catch (error: any) {
                vscode.window.showErrorMessage(vscode.l10n.t('Failed to rebase onto {0}: {1}', branchToRebaseOnto, error.message));
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
                vscode.window.showInformationMessage(vscode.l10n.t('Pulled {0}/{1}', remote, branch));
            } catch (error: any) {
                vscode.window.showErrorMessage(vscode.l10n.t('Failed to pull: {0}', error.message));
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.branch.push', async (arg) => {
            const branch = getBranchName(arg);
            if (!branch) return;

            try {
                const remotes = await gitService.getRemotes();
                const remote = remotes.length > 0 ? remotes[0] : 'origin';
                await gitService.push(remote, branch);

                // Auto-set upstream if not already set
                const upstream = await gitService.getUpstreamBranch(branch);
                if (!upstream) {
                    try {
                        await gitService.setUpstreamBranch(remote, branch);
                    } catch {
                        // Ignore upstream set errors
                    }
                }

                vscode.window.showInformationMessage(vscode.l10n.t('Pushed {0} to {1}', branch, remote));
            } catch (error: any) {
                vscode.window.showErrorMessage(vscode.l10n.t('Failed to push: {0}', error.message));
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.branch.update', async (arg) => {
            const branch = getBranchName(arg);
            if (!branch) return;

            try {
                const currentBranch = (await gitService.getBranches()).current;

                if (branch === currentBranch) {
                    await gitService.pull();
                    vscode.window.showInformationMessage(vscode.l10n.t('Updated current branch'));
                } else {
                    await gitService.fetch();
                    vscode.window.showInformationMessage(vscode.l10n.t('Fetched updates for {0}', branch));
                }
            } catch (error: any) {
                vscode.window.showErrorMessage(vscode.l10n.t('Failed to update: {0}', error.message));
            }
        })
    );
}
