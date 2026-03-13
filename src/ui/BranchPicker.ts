import * as vscode from 'vscode';
import { GitService } from '../services/GitService';

interface BranchQuickPickItem extends vscode.QuickPickItem {
    action?: 'fetch' | 'update' | 'commit' | 'push' | 'newBranch' | 'checkout';
    branch?: string;
    isRemote?: boolean;
}

export class BranchPicker {
    private isDeleteMode: boolean = false;

    constructor(private gitService: GitService) { }

    public async show() {
        const quickPick = vscode.window.createQuickPick<BranchQuickPickItem>();
        quickPick.matchOnDescription = true;
        quickPick.matchOnDetail = true;

        const updatePickerState = async () => {
            quickPick.busy = true;
            if (this.isDeleteMode) {
                quickPick.placeholder = vscode.l10n.t('Select branches to delete...');
                quickPick.canSelectMany = true;
                quickPick.buttons = [
                    {
                        iconPath: new vscode.ThemeIcon('arrow-left'),
                        tooltip: vscode.l10n.t('Back to Checkout')
                    },
                    {
                        iconPath: new vscode.ThemeIcon('trash'),
                        tooltip: vscode.l10n.t('Confirm Delete')
                    }
                ];
            } else {
                quickPick.placeholder = vscode.l10n.t('Search branches or select action...');
                quickPick.canSelectMany = false;
                quickPick.buttons = [
                    {
                        iconPath: new vscode.ThemeIcon('trash'),
                        tooltip: vscode.l10n.t('Delete Branches')
                    },
                    {
                        iconPath: new vscode.ThemeIcon('cloud-download'),
                        tooltip: vscode.l10n.t('Fetch from remote')
                    }
                ];
            }

            const items = await this._buildQuickPickItems();
            quickPick.items = items;
            quickPick.selectedItems = [];
            quickPick.busy = false;
        };

        await updatePickerState();

        quickPick.onDidTriggerButton(async (button) => {
            if (button.tooltip === vscode.l10n.t('Fetch from remote')) {
                quickPick.busy = true;
                try {
                    await this.gitService.fetch();
                    await updatePickerState();
                } catch (e) {
                    vscode.window.showErrorMessage(vscode.l10n.t('Fetch failed: {0}', String(e)));
                } finally {
                    quickPick.busy = false;
                }
            } else if (button.tooltip === vscode.l10n.t('Delete Branches')) {
                this.isDeleteMode = true;
                await updatePickerState();
            } else if (button.tooltip === vscode.l10n.t('Back to Checkout')) {
                this.isDeleteMode = false;
                await updatePickerState();
            } else if (button.tooltip === vscode.l10n.t('Confirm Delete')) {
                if (quickPick.selectedItems.length === 0) {
                    return;
                }

                const branchesToDelete = quickPick.selectedItems
                    .filter(i => i.branch && !i.isRemote)
                    .map(i => i.branch!);

                if (branchesToDelete.length === 0) {
                    return;
                }

                const answer = await vscode.window.showWarningMessage(
                    vscode.l10n.t('Are you sure you want to delete {0} branches?', branchesToDelete.length),
                    { modal: true },
                    vscode.l10n.t('Delete')
                );

                if (answer === vscode.l10n.t('Delete')) {
                    quickPick.busy = true;
                    try {
                        await this.gitService.deleteBranches(branchesToDelete, true);
                        await updatePickerState();
                    } catch (e) {
                        vscode.window.showErrorMessage(vscode.l10n.t('Failed to delete branches: {0}', String(e)));
                    } finally {
                        quickPick.busy = false;
                    }
                }
            }
        });

        quickPick.onDidTriggerItemButton(async (e) => {
            const item = e.item as BranchQuickPickItem;
            if (e.button.tooltip === vscode.l10n.t('Rename Branch')) {
                if (item.branch) {
                    await this._handleRename(item.branch);
                    await updatePickerState();
                }
            }
        });

        quickPick.onDidChangeSelection(async (selection) => {
            if (this.isDeleteMode) {
                return;
            }

            const item = selection[0];
            if (!item) return;

            quickPick.hide();

            switch (item.action) {
                case 'fetch':
                    await this._handleFetch();
                    break;
                case 'update':
                    await this._handleUpdate();
                    break;
                case 'commit':
                    vscode.commands.executeCommand('intelli-git.focusCommitView');
                    break;
                case 'push':
                    vscode.commands.executeCommand('intelli-git.push');
                    break;
                case 'newBranch':
                    await this._handleNewBranch();
                    break;
                case 'checkout':
                    if (item.branch) {
                        await this._handleCheckout(item.branch, item.isRemote);
                    }
                    break;
            }
        });

        quickPick.onDidHide(() => quickPick.dispose());
        quickPick.show();
    }

    private async _buildQuickPickItems(): Promise<BranchQuickPickItem[]> {
        const items: BranchQuickPickItem[] = [];
        const branches = await this.gitService.getBranches();

        if (this.isDeleteMode) {
            branches.all.forEach(branch => {
                const isCurrent = branch === branches.current;
                if (isCurrent) return;

                items.push({
                    label: `$(git-branch) ${branch}`,
                    description: '',
                    branch: branch,
                    isRemote: false
                });
            });
            return items;
        }

        const remoteBranches = await this.gitService.getRemoteBranches();
        const remotes = await this.gitService.getRemotes();

        items.push({
            label: '$(cloud-download) ' + vscode.l10n.t('Fetch'),
            description: vscode.l10n.t('Fetch latest changes from remote'),
            action: 'fetch'
        });

        items.push({
            label: '$(arrow-down) ' + vscode.l10n.t('Update Project'),
            description: vscode.l10n.t('Pull latest changes'),
            action: 'update'
        });

        items.push({
            label: '$(check) ' + vscode.l10n.t('Commit'),
            description: vscode.l10n.t('Open commit panel'),
            action: 'commit'
        });

        items.push({
            label: '$(arrow-up) ' + vscode.l10n.t('Push'),
            description: vscode.l10n.t('Push commits to remote'),
            action: 'push'
        });

        items.push({
            label: '$(add) ' + vscode.l10n.t('New Branch'),
            description: vscode.l10n.t('Create a new branch'),
            action: 'newBranch'
        });

        items.push({
            label: vscode.l10n.t('Local'),
            kind: vscode.QuickPickItemKind.Separator
        });

        branches.all.forEach(branch => {
            const isCurrent = branch === branches.current;
            items.push({
                label: `$(git-branch) ${branch}`,
                description: isCurrent ? '$(check) ' + vscode.l10n.t('current') : '',
                action: 'checkout',
                branch: branch,
                isRemote: false,
                buttons: [
                    {
                        iconPath: new vscode.ThemeIcon('edit'),
                        tooltip: vscode.l10n.t('Rename Branch')
                    }
                ]
            });
        });

        for (const remote of remotes) {
            const remoteBranchesForRemote = remoteBranches
                .filter(b => b.startsWith(`${remote}/`))
                .map(b => b.replace(`${remote}/`, ''));

            if (remoteBranchesForRemote.length > 0) {
                items.push({
                    label: vscode.l10n.t('Remote ({0})', remote),
                    kind: vscode.QuickPickItemKind.Separator
                });

                remoteBranchesForRemote.forEach(branch => {
                    if (branch === 'HEAD') return;
                    const existsLocally = branches.all.includes(branch);
                    items.push({
                        label: `$(cloud) ${branch}`,
                        description: existsLocally ? vscode.l10n.t('exists locally') : '',
                        action: 'checkout',
                        branch: `${remote}/${branch}`,
                        isRemote: true
                    });
                });
            }
        }

        return items;
    }

    private async _handleFetch() {
        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: vscode.l10n.t('Fetching from remote...'),
                    cancellable: false
                },
                async () => {
                    await this.gitService.fetch();
                }
            );
        } catch (e) {
            vscode.window.showErrorMessage(vscode.l10n.t('Fetch failed: {0}', String(e)));
        }
    }

    private async _handleUpdate() {
        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: vscode.l10n.t('Updating project...'),
                    cancellable: false
                },
                async () => {
                    await this.gitService.pull();
                }
            );
            vscode.commands.executeCommand('intelli-git.refresh');
        } catch (e) {
            vscode.window.showErrorMessage(vscode.l10n.t('Update failed: {0}', String(e)));
        }
    }

    private async _handleNewBranch() {
        const branchName = await vscode.window.showInputBox({
            prompt: vscode.l10n.t('Enter new branch name'),
            placeHolder: 'feature/my-new-branch',
            validateInput: (value) => {
                if (!value) return vscode.l10n.t('Branch name is required');
                if (value.includes(' ')) return vscode.l10n.t('Branch name cannot contain spaces');
                return null;
            }
        });

        if (!branchName) return;

        try {
            await this.gitService.createBranch(branchName);
            vscode.commands.executeCommand('intelli-git.refresh');
        } catch (e) {
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to create branch: {0}', String(e)));
        }
    }

    private async _handleCheckout(branch: string, isRemote?: boolean) {
        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: vscode.l10n.t('Switching to {0}...', branch),
                    cancellable: false
                },
                async (progress) => {
                    await this._performCheckout(branch, isRemote, false, progress);
                }
            );
            vscode.commands.executeCommand('intelli-git.refresh');
        } catch (e: any) {
            if (this._isLocalChangesError(e)) {
                await this._handleSmartCheckout(branch, isRemote);
            } else {
                vscode.window.showErrorMessage(vscode.l10n.t('Failed to switch branch: {0}', String(e)));
            }
        }
    }

    private async _performCheckout(
        branch: string,
        isRemote?: boolean,
        force: boolean = false,
        progress?: vscode.Progress<{ message?: string }>
    ) {
        if (isRemote) {
            const parts = branch.split('/');
            const remote = parts[0];
            const localBranchName = parts.slice(1).join('/');

            const localBranches = await this.gitService.getBranches();
            if (localBranches.all.includes(localBranchName)) {
                // Check if local branch is ahead of remote
                const aheadCount = await this.gitService.getCommitsToPushCount(localBranchName, remote, localBranchName);
                if (aheadCount > 0) {
                    const action = await vscode.window.showWarningMessage(
                        vscode.l10n.t('Checkout Remote Branch'),
                        {
                            modal: true,
                            detail: vscode.l10n.t('Local branch {0} has {1} commits not in {2}.', localBranchName, aheadCount, branch)
                        },
                        vscode.l10n.t('Rebase'),
                        vscode.l10n.t('Delete Local Commits'),
                        vscode.l10n.t('Cancel')
                    );

                    if (action === vscode.l10n.t('Cancel') || !action) {
                        return;
                    }

                    if (action === vscode.l10n.t('Rebase')) {
                        progress?.report({ message: vscode.l10n.t('Rebasing {0} onto {1}...', localBranchName, branch) });
                        await this.gitService.switchBranch(localBranchName, force);
                        await this.gitService.rebaseOnto(branch);
                        return;
                    } else if (action === vscode.l10n.t('Delete Local Commits')) {
                        progress?.report({ message: vscode.l10n.t('Resetting {0} to {1}...', localBranchName, branch) });
                        await this.gitService.switchBranch(localBranchName, force);
                        await this.gitService.reset('hard', branch);
                        return;
                    }
                }

                progress?.report({ message: vscode.l10n.t('Pulling {0}...', localBranchName) });
                await this.gitService.switchBranch(localBranchName, force);
                await this.gitService.pull();
            } else {
                await this.gitService.checkoutRemoteBranch(branch, force);
            }
        } else {
            await this.gitService.switchBranch(branch, force);
        }
    }

    private _isLocalChangesError(e: any): boolean {
        const msg = String(e);
        return msg.includes('Your local changes to the following files would be overwritten by checkout') ||
            msg.includes('The following untracked working tree files would be overwritten by checkout') ||
            msg.includes('Please commit your changes or stash them before you switch branches');
    }

    private async _handleSmartCheckout(branch: string, isRemote?: boolean) {
        const action = await vscode.window.showWarningMessage(
            vscode.l10n.t('Checkout Conflict'),
            { modal: true, detail: vscode.l10n.t('Your local changes would be overwritten by checkout.\nGit suggests committing or stashing them.') },
            vscode.l10n.t('Smart Checkout'),
            vscode.l10n.t('Force Checkout'),
            vscode.l10n.t('Cancel')
        );

        if (action === vscode.l10n.t('Cancel') || !action) {
            return;
        }

        if (action === vscode.l10n.t('Smart Checkout')) {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: vscode.l10n.t('Smart Checkout: Stashing & Switching...'),
                    cancellable: false
                },
                async () => {
                    try {
                        await this.gitService.stash(`Smart Checkout: ${branch} at ${new Date().toISOString()}`, undefined, true);

                        await this._performCheckout(branch, isRemote);

                        try {
                            await this.gitService.popLatestStash();
                            vscode.commands.executeCommand('intelli-git.refresh');
                        } catch (popError: any) {
                            const errorMsg = String(popError);
                            if (errorMsg.includes('could not restore untracked files')) {
                                vscode.window.showWarningMessage(
                                    vscode.l10n.t('Checkout successful, but could not restore untracked files because they exist in the current branch. Your changes are saved in the Stash list.')
                                );
                            } else {
                                vscode.window.showWarningMessage(
                                    vscode.l10n.t('Checkout successful, but conflicts occurred while restoring changes. Stash is kept for safety. Please resolve manually.')
                                );
                            }
                            vscode.commands.executeCommand('intelli-git.refresh');
                        }
                    } catch (e) {
                        vscode.window.showErrorMessage(vscode.l10n.t('Smart Checkout failed: {0}', String(e)));
                    }
                }
            );
        } else if (action === vscode.l10n.t('Force Checkout')) {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: vscode.l10n.t('Force Switching to {0}...', branch),
                    cancellable: false
                },
                async () => {
                    try {
                        await this._performCheckout(branch, isRemote, true);
                        vscode.commands.executeCommand('intelli-git.refresh');
                    } catch (e) {
                        vscode.window.showErrorMessage(vscode.l10n.t('Force Checkout failed: {0}', String(e)));
                    }
                }
            );
        }
    }

    private async _handleRename(branch: string) {
        const newName = await vscode.window.showInputBox({
            prompt: vscode.l10n.t('Enter new branch name for {0}', branch),
            value: branch,
            validateInput: (value) => {
                if (!value) return vscode.l10n.t('Branch name is required');
                if (value.includes(' ')) return vscode.l10n.t('Branch name cannot contain spaces');
                if (value === branch) return vscode.l10n.t('Please enter a different name');
                return null;
            }
        });

        if (!newName) return;

        try {
            await this.gitService.renameBranch(branch, newName);
            vscode.commands.executeCommand('intelli-git.refresh');
        } catch (e) {
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to rename branch: {0}', String(e)));
        }
    }
}
