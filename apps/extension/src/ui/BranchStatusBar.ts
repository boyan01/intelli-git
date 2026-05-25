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
            'intelli-git.branch',
            vscode.StatusBarAlignment.Left,
            9999
        );
        this.statusBarItem.name = vscode.l10n.t('Intelli Git: Branch');
        this.statusBarItem.command = 'intelli-git.showBranchPicker';

        this.update();
    }

    public async update() {
        try {
            const branches = await this.gitService.branchRemote.getBranches();
            this.currentBranch = branches.current;
            this.statusBarItem.text = `$(git-branch) ${this.currentBranch}`;
            this.statusBarItem.tooltip = this.repository?.name
                ? `${vscode.l10n.t('Switch Branch')} · ${this.repository.name}`
                : vscode.l10n.t('Switch Branch');
            this.statusBarItem.show();
        } catch {
            this.statusBarItem.text = `$(git-branch) ${vscode.l10n.t('No Branch')}`;
            this.statusBarItem.tooltip = this.repository?.name
                ? `${vscode.l10n.t('Switch Branch')} · ${this.repository.name}`
                : vscode.l10n.t('Switch Branch');
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
