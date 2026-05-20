import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { BranchStatusBar } from '../ui/BranchStatusBar';
import { CommitViewProvider } from '../providers/CommitViewProvider';
import { GitLogViewProvider } from '../providers/GitLogViewProvider';
import { GitService } from '../services/GitService';
import { RepositoryManager } from '../services/RepositoryManager';

function normalizeExistingPath(filePath: string): string {
    try {
        return path.normalize(fs.realpathSync(filePath));
    } catch {
        return path.normalize(filePath);
    }
}

/**
 * Register navigation commands that do not require an active repository.
 */
export function registerGlobalNavigationCommands(
    context: vscode.ExtensionContext,
    gitLogProvider: GitLogViewProvider
): void {
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

/**
 * Register navigation and branch-related commands that require an active repository.
 */
export function registerNavigationCommands(
    context: vscode.ExtensionContext,
    branchStatusBar: BranchStatusBar,
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
}

export function registerWorktreeCommands(
    context: vscode.ExtensionContext,
    gitService: GitService,
    repositoryManager: RepositoryManager,
    commitViewProvider: CommitViewProvider
): void {
    const refreshWorktreeState = async () => {
        await repositoryManager.initialize();
        commitViewProvider.rpc?.refresh();
    };

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.worktrees.toggleDrawer', () => {
            commitViewProvider.toggleWorktreesDrawer();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.worktree.switch', async (args?: { path?: string }) => {
            if (!args?.path) {
                return;
            }

            const normalizedPath = normalizeExistingPath(args.path);
            const repo = repositoryManager.getRepositories().find(item => normalizeExistingPath(item.repoPath) === normalizedPath);
            if (!repo) {
                await vscode.window.showWarningMessage(vscode.l10n.t('Open this worktree in VS Code before switching Intelli Git to it.'));
                return;
            }

            repositoryManager.setActiveRepository(repo.repoPath);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.worktree.open', async (args?: { path?: string }) => {
            if (args?.path) {
                await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(args.path), { forceNewWindow: true });
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.worktree.reveal', async (args?: { path?: string }) => {
            if (args?.path) {
                await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(args.path));
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.worktree.prune', async () => {
            await gitService.branchRemote.pruneWorktrees();
            await refreshWorktreeState();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.worktree.remove', async (args?: { path?: string; branch?: string; isDirty?: boolean }) => {
            if (!args?.path) {
                return;
            }

            const isDirty = args.isDirty ?? false;
            let confirm: string | undefined;

            if (isDirty) {
                confirm = await vscode.window.showWarningMessage(
                    vscode.l10n.t('Worktree {0} has uncommitted changes. Removing it will permanently delete all uncommitted changes on disk. Are you sure you want to force remove it?', args.branch || args.path),
                    { modal: true, detail: args.path },
                    vscode.l10n.t('Force Remove')
                );
                if (confirm !== vscode.l10n.t('Force Remove')) {
                    return;
                }
            } else {
                confirm = await vscode.window.showWarningMessage(
                    vscode.l10n.t('Remove worktree {0}?', args.branch || args.path),
                    { modal: true, detail: args.path },
                    vscode.l10n.t('Remove')
                );
                if (confirm !== vscode.l10n.t('Remove')) {
                    return;
                }
            }

            try {
                await gitService.branchRemote.removeWorktree(args.path, isDirty);
                await refreshWorktreeState();
            } catch (error) {
                vscode.window.showErrorMessage(vscode.l10n.t('Failed to remove worktree: {0}', String(error)));
            }
        })
    );
}
