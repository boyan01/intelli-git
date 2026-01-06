import * as vscode from 'vscode';
import { GitService } from '../services/GitService';
import { BranchPicker } from './BranchPicker';

export class BranchStatusBar {
    private statusBarItem: vscode.StatusBarItem;
    private gitService: GitService;
    private currentBranch: string = '';

    constructor(gitService: GitService) {
        this.gitService = gitService;
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
            const branches = await this.gitService.getBranches();
            this.currentBranch = branches.current;
            this.statusBarItem.text = `$(git-branch) ${this.currentBranch}`;
            this.statusBarItem.show();
        } catch (e) {
            this.statusBarItem.text = `$(git-branch) ${vscode.l10n.t('No Branch')}`;
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
