import * as vscode from 'vscode';
import { GitService } from '../services/GitService';

interface CheckoutWorktreeConflictOptions {
    gitService: GitService;
    branch: string;
    isRemote?: boolean;
    error: unknown;
    retry: () => Promise<void>;
}

export async function handleCheckoutWorktreeConflict(options: CheckoutWorktreeConflictOptions): Promise<boolean> {
    const localBranchName = getLocalCheckoutBranchName(options.branch, options.isRemote);
    const usage = await options.gitService.branchRemote.resolveWorktreeBranchUsage(localBranchName, options.error);
    if (!usage) {
        return false;
    }

    if (usage.pathExists) {
        const openWorktree = vscode.l10n.t('Open Worktree');
        const revealInFileManager = vscode.l10n.t('Reveal in File Manager');
        const cancel = vscode.l10n.t('Cancel');
        const action = await vscode.window.showWarningMessage(
            vscode.l10n.t('Branch Already Checked Out'),
            {
                modal: true,
                detail: vscode.l10n.t(
                    'Branch "{0}" is already checked out in another worktree:\n\n{1}',
                    usage.branch,
                    usage.path
                ),
            },
            openWorktree,
            revealInFileManager,
            cancel
        );

        if (action === openWorktree) {
            await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(usage.path), {
                forceNewWindow: true,
            });
        } else if (action === revealInFileManager) {
            await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(usage.path));
        }

        return true;
    }

    const pruneAndRetry = vscode.l10n.t('Prune Stale Worktrees and Retry');
    const cancel = vscode.l10n.t('Cancel');
    const action = await vscode.window.showWarningMessage(
        vscode.l10n.t('Stale Worktree Reference'),
        {
            modal: true,
            detail: vscode.l10n.t(
                'Branch "{0}" is still registered to a missing worktree path:\n\n{1}',
                usage.branch,
                usage.path
            ),
        },
        pruneAndRetry,
        cancel
    );

    if (action === pruneAndRetry) {
        await options.gitService.branchRemote.pruneWorktrees();
        await options.retry();
    }

    return true;
}

function getLocalCheckoutBranchName(branch: string, isRemote?: boolean): string {
    if (!isRemote) {
        return branch;
    }

    const parts = branch.split('/');
    return parts.slice(1).join('/');
}
