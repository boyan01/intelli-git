import * as vscode from 'vscode';
import { GitService } from '../services/GitService';
import type { RepositoryScope } from '../services/RepositoryManager';

export class GitLogStatusBar {
    private statusBarItem: vscode.StatusBarItem;
    private gitService: GitService;
    private repository?: RepositoryScope;

    constructor(gitService: GitService, repository?: RepositoryScope) {
        this.gitService = gitService;
        this.repository = repository;
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            9998
        );
        this.statusBarItem.command = 'intelli-git.focusGitLog';
        this.statusBarItem.tooltip = vscode.l10n.t('Open Git Log');
        this.statusBarItem.text = this.repository?.name ? `$(history) ${this.repository.name}` : '$(history)';

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
