import * as vscode from 'vscode';
import { GitService, CommitInfo } from './GitService';
import type { PushViewMessage, CommitFile } from '@shared/messages';
import { getWebviewHtml } from './utils/webviewHtml';

export class PushPanel {
    public static currentPanel: PushPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _gitService: GitService;
    private _disposables: vscode.Disposable[] = [];

    private _currentBranch: string = '';
    private _remote: string = 'origin';
    private _remoteBranch: string = '';
    private _remotes: string[] = [];
    private _remoteBranches: string[] = [];
    private _commits: CommitInfo[] = [];
    private _files: CommitFile[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        gitService: GitService
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._gitService = gitService;

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async (message: PushViewMessage) => {
                switch (message.type) {
                    case 'ready': await this._loadData(); break;
                    case 'push': await this._doPush(message.force, message.pushTags); break;
                    case 'cancel': this._panel.dispose(); break;
                    case 'selectCommit': await this._loadFilesForCommit(message.index); break;
                    case 'openDiff': this._openDiff(message.path); break;
                    case 'changeRemote': this._remote = message.remote; await this._refreshCommits(); break;
                    case 'changeRemoteBranch': this._remoteBranch = message.branch; await this._refreshCommits(); break;
                }
            },
            null,
            this._disposables
        );

        this._initialize();
    }

    public static createOrShow(extensionUri: vscode.Uri, gitService: GitService) {
        if (PushPanel.currentPanel) {
            PushPanel.currentPanel._panel.reveal(vscode.ViewColumn.Active);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'ideaPushPanel',
            'Push Commits',
            {
                viewColumn: vscode.ViewColumn.Active,
                preserveFocus: false
            },
            {
                enableScripts: true,
                localResourceRoots: [extensionUri],
                retainContextWhenHidden: true
            }
        );

        PushPanel.currentPanel = new PushPanel(panel, extensionUri, gitService);
    }

    public dispose() {
        PushPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private async _initialize() {
        const branches = await this._gitService.getBranches();
        this._currentBranch = branches.current;
        this._remoteBranch = branches.current;
        this._remotes = await this._gitService.getRemotes();
        this._remoteBranches = await this._gitService.getRemoteBranches();
        
        this._panel.webview.html = this._getHtmlForWebview();
    }

    private async _loadData() {
        await this._refreshCommits();
    }

    private async _refreshCommits() {
        this._commits = await this._gitService.getCommitsToPush(
            this._currentBranch,
            this._remote,
            this._remoteBranch
        );

        if (this._commits.length > 0) {
            this._files = await this._getFilesForCommit(this._commits[0].hash);
        } else {
            this._files = [];
        }

        this._panel.webview.postMessage({
            type: 'update',
            commits: this._commits,
            files: this._files,
            config: {
                currentBranch: this._currentBranch,
                remote: this._remote,
                remoteBranch: this._remoteBranch,
                remotes: this._remotes,
                remoteBranches: this._remoteBranches
            }
        });
    }

    private async _loadFilesForCommit(index: number) {
        if (index >= 0 && index < this._commits.length) {
            this._files = await this._getFilesForCommit(this._commits[index].hash);
            this._panel.webview.postMessage({
                type: 'updateFiles',
                files: this._files
            });
        }
    }

    private async _getFilesForCommit(hash: string): Promise<CommitFile[]> {
        try {
            return await this._gitService.getCommitFiles(hash);
        } catch {
            return [];
        }
    }

    private async _doPush(force: boolean, pushTags: boolean) {
        try {
            if (force) {
                await this._gitService.forcePush(this._remote, `${this._currentBranch}:${this._remoteBranch}`);
            } else {
                await this._gitService.push(this._remote, `${this._currentBranch}:${this._remoteBranch}`);
            }
            
            if (pushTags) {
                await this._gitService.pushTags(this._remote);
            }

            this._panel.webview.postMessage({ type: 'pushComplete' });
            vscode.window.showInformationMessage(
                `Successfully pushed to ${this._remote}/${this._remoteBranch}`
            );
            this.dispose();
        } catch (e) {
            this._panel.webview.postMessage({ type: 'pushError' });
            vscode.window.showErrorMessage(`Push failed: ${e}`);
        }
    }

    private _openDiff(filePath: string) {
        const workspaceRoot = this._gitService.getWorkspaceRoot();
        const uri = vscode.Uri.file(`${workspaceRoot}/${filePath}`);
        vscode.commands.executeCommand('git.openChange', uri);
    }

    private _getHtmlForWebview() {
        return getWebviewHtml({
            webview: this._panel.webview,
            extensionUri: this._extensionUri,
            title: 'Push Commits',
            initialRoute: '/push'
        });
    }
}
