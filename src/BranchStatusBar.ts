import * as vscode from 'vscode';
import { BranchInfo } from '../shared/messages';
import { GitService } from './GitService';

interface BranchQuickPickItem extends vscode.QuickPickItem {
    action?: 'fetch' | 'update' | 'commit' | 'push' | 'newBranch' | 'checkout';
    branch?: string;
    isRemote?: boolean;
}

export class BranchStatusBar {
    private statusBarItem: vscode.StatusBarItem;
    private gitService: GitService;
    private currentBranch: string = '';

    constructor(gitService: GitService) {
        this.gitService = gitService;
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );
        this.statusBarItem.command = 'idea-commit-panel.showBranchPicker';
        this.statusBarItem.tooltip = 'Switch Branch';
        this.update();
    }

    public async update() {
        try {
            const branches = await this.gitService.getBranches();
            this.currentBranch = branches.current;
            this.statusBarItem.text = `$(git-branch) ${this.currentBranch}`;
            this.statusBarItem.show();
        } catch (e) {
            this.statusBarItem.text = '$(git-branch) No Branch';
            this.statusBarItem.show();
        }
    }

    public dispose() {
        this.statusBarItem.dispose();
    }

    public async showBranchPicker() {
        const quickPick = vscode.window.createQuickPick<BranchQuickPickItem>();
        quickPick.placeholder = 'Search branches or select action...';
        quickPick.matchOnDescription = true;
        quickPick.matchOnDetail = true;

        const items = await this._buildQuickPickItems();
        quickPick.items = items;

        quickPick.buttons = [
            {
                iconPath: new vscode.ThemeIcon('cloud-download'),
                tooltip: 'Fetch from remote'
            }
        ];

        quickPick.onDidTriggerButton(async (button) => {
            if (button.tooltip === 'Fetch from remote') {
                quickPick.busy = true;
                try {
                    await this.gitService.fetch();
                    vscode.window.showInformationMessage('Fetched from remote.');
                    const newItems = await this._buildQuickPickItems();
                    quickPick.items = newItems;
                } catch (e) {
                    vscode.window.showErrorMessage(`Fetch failed: ${e}`);
                } finally {
                    quickPick.busy = false;
                }
            }
        });

        quickPick.onDidChangeSelection(async (selection) => {
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
                    vscode.commands.executeCommand('idea-commit-panel.focusCommitView');
                    break;
                case 'push':
                    vscode.commands.executeCommand('idea-commit-panel.push');
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
        const remoteBranches = await this.gitService.getRemoteBranches();
        const remotes = await this.gitService.getRemotes();

        // Actions section
        items.push({
            label: '$(cloud-download) Fetch',
            description: 'Fetch latest changes from remote',
            action: 'fetch'
        });

        items.push({
            label: '$(arrow-down) Update Project',
            description: 'Pull latest changes',
            action: 'update'
        });

        items.push({
            label: '$(check) Commit',
            description: 'Open commit panel',
            action: 'commit'
        });

        items.push({
            label: '$(arrow-up) Push',
            description: 'Push commits to remote',
            action: 'push'
        });

        items.push({
            label: '$(add) New Branch',
            description: 'Create a new branch',
            action: 'newBranch'
        });

        // Local branches section
        items.push({
            label: 'Local',
            kind: vscode.QuickPickItemKind.Separator
        });

        branches.all.forEach(branch => {
            const isCurrent = branch === branches.current;
            items.push({
                label: `$(git-branch) ${branch}`,
                description: isCurrent ? '$(check) current' : '',
                action: 'checkout',
                branch: branch,
                isRemote: false
            });
        });

        // Remote branches section (grouped by remote)
        for (const remote of remotes) {
            const remoteBranchesForRemote = remoteBranches
                .filter(b => b.startsWith(`${remote}/`))
                .map(b => b.replace(`${remote}/`, ''));

            if (remoteBranchesForRemote.length > 0) {
                items.push({
                    label: `Remote (${remote})`,
                    kind: vscode.QuickPickItemKind.Separator
                });

                remoteBranchesForRemote.forEach(branch => {
                    if (branch === 'HEAD') return;
                    const existsLocally = branches.all.includes(branch);
                    items.push({
                        label: `$(cloud) ${branch}`,
                        description: existsLocally ? 'exists locally' : '',
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
                    title: 'Fetching from remote...',
                    cancellable: false
                },
                async () => {
                    await this.gitService.fetch();
                }
            );
            vscode.window.showInformationMessage('Fetched from remote.');
        } catch (e) {
            vscode.window.showErrorMessage(`Fetch failed: ${e}`);
        }
    }

    private async _handleUpdate() {
        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Updating project...',
                    cancellable: false
                },
                async () => {
                    await this.gitService.pull();
                }
            );
            vscode.window.showInformationMessage('Project updated.');
            this.update();
        } catch (e) {
            vscode.window.showErrorMessage(`Update failed: ${e}`);
        }
    }

    private async _handleNewBranch() {
        const branchName = await vscode.window.showInputBox({
            prompt: 'Enter new branch name',
            placeHolder: 'feature/my-new-branch',
            validateInput: (value) => {
                if (!value) return 'Branch name is required';
                if (value.includes(' ')) return 'Branch name cannot contain spaces';
                return null;
            }
        });

        if (!branchName) return;

        try {
            await this.gitService.createBranch(branchName);
            vscode.window.showInformationMessage(`Created and switched to branch: ${branchName}`);
            this.update();
        } catch (e) {
            vscode.window.showErrorMessage(`Failed to create branch: ${e}`);
        }
    }

    private async _handleCheckout(branch: string, isRemote?: boolean) {
        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Switching to ${branch}...`,
                    cancellable: false
                },
                async () => {
                    if (isRemote) {
                        await this.gitService.checkoutRemoteBranch(branch);
                    } else {
                        await this.gitService.switchBranch(branch);
                    }
                }
            );
            this.update();
        } catch (e) {
            vscode.window.showErrorMessage(`Failed to switch branch: ${e}`);
        }
    }
}
