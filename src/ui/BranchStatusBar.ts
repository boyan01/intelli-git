import * as vscode from 'vscode';
import { GitService } from '../services/GitService';
import { BranchPicker } from './BranchPicker';

export class BranchStatusBar {
    private statusBarItem: vscode.StatusBarItem;
    private logStatusBarItem: vscode.StatusBarItem;
    private gitService: GitService;
    private currentBranch: string = '';

    constructor(gitService: GitService) {
        this.gitService = gitService;
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );
        this.statusBarItem.command = 'intelli-git.showBranchPicker';
        this.statusBarItem.tooltip = 'Switch Branch';

        this.logStatusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            99
        );
        this.logStatusBarItem.command = 'intelli-git.focusGitLog';
        this.logStatusBarItem.tooltip = 'Open Git Log';
        this.logStatusBarItem.text = '$(history)';

        this.update();
    }

    public async update() {
        try {
            const branches = await this.gitService.getBranches();
            this.currentBranch = branches.current;
            this.statusBarItem.text = `$(git-branch) ${this.currentBranch}`;
            this.statusBarItem.show();
            this.logStatusBarItem.show();
        } catch (e) {
            this.statusBarItem.text = '$(git-branch) No Branch';
            this.statusBarItem.show();
            this.logStatusBarItem.hide();
        }
    }

    public dispose() {
        this.statusBarItem.dispose();
        this.logStatusBarItem.dispose();
    }

    public async showBranchPicker() {
        const picker = new BranchPicker(this.gitService);
        await picker.show();
    }
}
