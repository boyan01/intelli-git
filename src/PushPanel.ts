import * as vscode from 'vscode';
import { GitService, CommitInfo } from './GitService';

interface CommitFile {
    path: string;
    status: string;
}

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
            async (message) => {
                switch (message.type) {
                    case 'ready':
                        await this._loadData();
                        break;
                    case 'push':
                        await this._doPush(message.force, message.pushTags);
                        break;
                    case 'cancel':
                        this._panel.dispose();
                        break;
                    case 'selectCommit':
                        await this._loadFilesForCommit(message.index);
                        break;
                    case 'openDiff':
                        this._openDiff(message.path);
                        break;
                    case 'changeRemote':
                        this._remote = message.remote;
                        await this._refreshCommits();
                        break;
                    case 'changeRemoteBranch':
                        this._remoteBranch = message.branch;
                        await this._refreshCommits();
                        break;
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

    private _getNonce() {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    private _getHtmlForWebview() {
        const webview = this._panel.webview;
        const nonce = this._getNonce();

        const styleResetUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'reset.css')
        );
        const styleVSCodeUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'vscode.css')
        );
        const stylePushUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'push.css')
        );
        const codiconUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css')
        );
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'push.js')
        );

        const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name || 'project';

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource} https:; script-src 'nonce-${nonce}';">
    <link href="${styleResetUri}" rel="stylesheet">
    <link href="${styleVSCodeUri}" rel="stylesheet">
    <link href="${codiconUri}" rel="stylesheet">
    <link href="${stylePushUri}" rel="stylesheet">
    <title>Push Commits</title>
</head>
<body>
    <div class="push-panel">
        <!-- Header -->
        <div class="push-header">
            <h2>Push commits to ${this._escapeHtml(workspaceName)}</h2>
            <button class="header-close-btn" onclick="vscode.postMessage({type:'cancel'})" title="Close">
                <i class="codicon codicon-close"></i>
            </button>
        </div>

        <!-- Warning Banner (hidden by default) -->
        <div id="warning-banner" class="warning-banner">
            <i class="codicon codicon-error icon"></i>
            <span class="message">Commit checks failed: 1 warning</span>
            <a class="action" href="#">Review code analysis</a>
        </div>

        <!-- Main Content -->
        <div class="push-main">
            <!-- Left: Commits -->
            <div class="commits-panel">
                <div class="commits-header">
                    <div class="branch-flow">
                        <span class="local-branch">${this._escapeHtml(this._currentBranch)}</span>
                        <span class="arrow">→</span>
                        <div class="remote-selector">
                            <select id="remote-select" class="branch-select">
                                ${this._remotes.map(r => 
                                    `<option value="${r}" ${r === this._remote ? 'selected' : ''}>${r}</option>`
                                ).join('')}
                            </select>
                            <span class="separator">:</span>
                            <div class="branch-input-wrapper">
                                <input type="text" 
                                       id="remote-branch-input" 
                                       class="branch-input" 
                                       value="${this._escapeHtml(this._remoteBranch)}"
                                       placeholder="branch name">
                                <div id="branch-suggestions" class="branch-suggestions"></div>
                            </div>
                        </div>
                    </div>
                </div>
                <div id="commits-list" class="commits-list"></div>
            </div>

            <!-- Resize Handle -->
            <div class="resize-handle"></div>

            <!-- Right: Files -->
            <div class="files-panel">
                <div class="files-toolbar">
                    <div class="toolbar-left">
                        <span id="files-count" class="files-count">0 files</span>
                    </div>
                    <div class="toolbar-right">
                        <button id="expand-all" class="toolbar-btn" title="Expand All">
                            <i class="codicon codicon-expand-all"></i>
                        </button>
                        <button id="collapse-all" class="toolbar-btn" title="Collapse All">
                            <i class="codicon codicon-collapse-all"></i>
                        </button>
                    </div>
                </div>
                <div id="files-list" class="files-list"></div>
                <div id="commit-details" class="commit-details">
                    <div class="commit-details-message"></div>
                    <div class="commit-details-meta"></div>
                </div>
            </div>
        </div>

        <!-- Footer -->
        <div class="push-footer">
            <div class="footer-left">
                <div class="push-tags-group">
                    <label>
                        <input type="checkbox" id="push-tags">
                        Push tags:
                    </label>
                    <select id="tag-option">
                        <option value="all">All</option>
                        <option value="current">Current</option>
                    </select>
                </div>
            </div>
            <div class="footer-right">
                <button id="cancel-btn" class="btn btn-secondary">Cancel</button>
                <div class="btn-split" style="position: relative;">
                    <button id="push-btn" class="btn btn-primary btn-main">Push</button>
                    <button id="push-dropdown-btn" class="btn btn-primary btn-dropdown">
                        <i class="codicon codicon-chevron-down"></i>
                    </button>
                    <div id="dropdown-menu" class="dropdown-menu">
                        <div id="force-push" class="dropdown-item">
                            <i class="codicon codicon-warning icon"></i>
                            <span>Force Push</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Loading Overlay -->
        <div id="loading-overlay" class="loading-overlay">
            <div class="loading-spinner"></div>
        </div>
    </div>

    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    private _escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}
