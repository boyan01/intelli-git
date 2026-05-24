import * as vscode from 'vscode';
import { GitService } from '../services/GitService';
import { BranchPicker } from './BranchPicker';
import type { RepositoryScope } from '../services/RepositoryManager';

export class BranchStatusBar {
    private statusBarItem: vscode.StatusBarItem;
    private gitService: GitService;
    private repository?: RepositoryScope;
    private currentBranch: string = '';

    constructor(gitService: GitService, repository?: RepositoryScope) {
        this.gitService = gitService;
        this.repository = repository;
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            9999
        );
        this.statusBarItem.command = 'intelli-git.showBranchPicker';
        this.statusBarItem.tooltip = vscode.l10n.t('Switch Branch');

        this.update();
    }

    public async update() {
        try {
            const branches = await this.gitService.branchRemote.getBranches();
            this.currentBranch = branches.current;
            this.statusBarItem.text = this.repository?.name
                ? `$(repo) ${this.repository.name} $(git-branch) ${this.currentBranch}`
                : `$(git-branch) ${this.currentBranch}`;
            this.statusBarItem.show();
        } catch {
            this.statusBarItem.text = this.repository?.name
                ? `$(repo) ${this.repository.name} $(git-branch) ${vscode.l10n.t('No Branch')}`
                : `$(git-branch) ${vscode.l10n.t('No Branch')}`;
            this.statusBarItem.show();
        }
    }

    public dispose() {
        this.statusBarItem.dispose();
    }

    public async showBranchPicker() {
        const picker = new BranchPicker(this.gitService);
        await picker.show();
    }
}
