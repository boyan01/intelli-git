import * as vscode from 'vscode';
import { GitService, CommitInfo } from './GitService';
import type { PushViewMessage, CommitFile, ExtensionMethods, WebviewMethods, PushData } from '../shared/messages';
import { RpcPeer } from '../shared/rpc';
import { getWebviewHtml } from './utils/webviewHtml';

export class PushPanel {
    public static currentPanel: PushPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _gitService: GitService;
    private _rpc?: RpcPeer<ExtensionMethods & WebviewMethods>;
    private _disposables: vscode.Disposable[] = [];

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

        // Initialize RPC
        this._rpc = new RpcPeer<ExtensionMethods & WebviewMethods>({
            postMessage: (msg: any) => this._panel.webview.postMessage(msg)
        });

        // Register default handlers
        this._rpc!.register('getVersion', () => '1.0.0');
        this._rpc!.register('echo', (msg: string) => msg);
        this._rpc!.register('getPushInitState', async () => {
            const branches = await this._gitService.getBranches();
            const remotes = await this._gitService.getRemotes();
            return {
                localBranch: branches.current,
                remotes: remotes.length > 0 ? remotes : ['origin']
            };
        });

        this._rpc!.register('getRemoteBranches', async (remote: string) => {
            const allRemoteBranches = await this._gitService.getRemoteBranches();
            // Filter branches that start with "remote/" and strip the prefix
            const prefix = `${remote}/`;
            return allRemoteBranches
                .filter(b => b.startsWith(prefix) && !b.includes('HEAD'))
                .map(b => b.substring(prefix.length));
        });

        this._rpc!.register('getPushCommits', async ({ remote, branch }) => {
            const branches = await this._gitService.getBranches();
            const currentBranch = branches.current;

            this._commits = await this._gitService.getCommitsToPush(
                currentBranch,
                remote,
                branch
            );

            let files: CommitFile[] = [];
            if (this._commits.length > 0) {
                files = await this._getFilesForCommit(this._commits[0].hash);
            }

            return {
                commits: this._commits,
                files: files
            };
        });

        this._rpc!.register('getCommitFiles', async (hash: string) => {
            return await this._getFilesForCommit(hash);
        });
        this._rpc!.register('push', async ({ force, pushTags, remote, branch }) => {
            await this._doPush(force, pushTags, remote, branch);
        });
        this._rpc!.register('openDiff', async (path: string) => {
            this._openDiff(path);
        });
        this._rpc!.register('cancel', async () => {
            this.dispose();
        });

        // Legacy handler kept for safety but can be removed if frontend is fully updated
        this._panel.webview.onDidReceiveMessage(
            async (message: PushViewMessage | { type: string }) => {
                // Handle RPC messages
                if (message.type === 'rpc-request' || message.type === 'rpc-response') {
                    this._rpc?.handleMessage(message);
                    return;
                } else {
                    console.log('Received unknown message type:', message.type);
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
        this._panel.webview.html = this._getHtmlForWebview();
    }

    private async _loadData(params?: { remote?: string; branch?: string }): Promise<PushData> {
        const branches = await this._gitService.getBranches();
        const currentBranch = branches.current;

        let remote = params?.remote;
        if (!remote) {
            const remotes = await this._gitService.getRemotes();
            remote = remotes.length > 0 ? remotes[0] : 'origin';
        }

        let remoteBranch = params?.branch;
        if (!remoteBranch) {
            remoteBranch = currentBranch;
        }

        const remotes = await this._gitService.getRemotes();
        const remoteBranches = await this._gitService.getRemoteBranches(); // optimization: pass remote to filter

        this._commits = await this._gitService.getCommitsToPush(
            currentBranch,
            remote,
            remoteBranch
        );

        let files: CommitFile[] = [];
        if (this._commits.length > 0) {
            files = await this._getFilesForCommit(this._commits[0].hash);
        }

        return {
            commits: this._commits,
            files: files,
            config: {
                currentBranch: currentBranch,
                remote: remote,
                remoteBranch: remoteBranch,
                remotes: remotes,
                remoteBranches: remoteBranches
            }
        };
    }

    // _refreshCommits removed as logic is now in _loadData

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

    private async _doPush(force: boolean, pushTags: boolean, remote: string, branch: string) {
        try {
            const branches = await this._gitService.getBranches();
            const currentBranch = branches.current;

            if (force) {
                await this._gitService.forcePush(remote, `${currentBranch}:${branch}`);
            } else {
                await this._gitService.push(remote, `${currentBranch}:${branch}`);
            }

            if (pushTags) {
                await this._gitService.pushTags(remote);
            }

            this._panel.webview.postMessage({ type: 'pushComplete' });
            vscode.window.showInformationMessage(
                `Successfully pushed to ${remote}/${branch}`
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
