import * as vscode from 'vscode';
import { GitService } from '../services/GitService';

export class GitLogStatusBar {
    private statusBarItem: vscode.StatusBarItem;
    private gitService: GitService;

    constructor(gitService: GitService) {
        this.gitService = gitService;
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            9998
        );
        this.statusBarItem.command = 'intelli-git.focusGitLog';
        this.statusBarItem.tooltip = vscode.l10n.t('Open Git Log');
        this.statusBarItem.text = '$(history)';

        this.update();
    }

    public async update() {
        // Ideally we check if there is a repo, but for now we follow BranchStatusBar logic
        // If BranchStatusBar shows something, we should probably show this too.
        // Or we can check if gitService has a root.
        if (this.gitService.getWorkspaceRoot()) {
            this.statusBarItem.show();
        } else {
            this.statusBarItem.hide();
        }
    }

    public dispose() {
        this.statusBarItem.dispose();
    }
}
