import * as vscode from 'vscode';
import { GitService } from './services/GitService';
import { ChangelistService } from './services/ChangelistService';
import type { ChangelistGroup, ExtensionMethods, WebviewMethods, CommitState } from '../shared/messages';
import { RpcPeer } from '../shared/rpc';
import { getWebviewHtml } from './utils/webviewHtml';
import { createRpc, createRpcMessageHandler, ExtensionRpcHandler } from './utils/rpcHelper';

export class CommitViewProvider implements vscode.WebviewViewProvider {

    public static readonly viewType = 'ideaCommitView';
    private _view?: vscode.WebviewView;
    private gitService: GitService;
    private changelistService: ChangelistService;
    private _rpc?: RpcPeer<WebviewMethods, ExtensionMethods>;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        gitService: GitService,
        changelistService: ChangelistService
    ) {
        this.gitService = gitService;
        this.changelistService = changelistService;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Initialize RPC
        this._rpc = createRpc({
            webview: webviewView.webview,
            onDisposed: () => !this._view
        });

        const handler = new ExtensionRpcHandler({
            gitService: this.gitService,
            changelistService: this.changelistService,
            getCommitState: () => this._getCommitStateData(),
            getChangelists: () => this._getChangelistsData(),
            getBranchInfo: () => this._getBranchInfo(),
            generateCommitMessage: (files) => this._generateCommitMessageFn(files)
        });
        handler.registerAll(this._rpc);

        // Listen to active text editor changes
        const activeEditorListener = vscode.window.onDidChangeActiveTextEditor(editor => {
            if (!editor) return;

            const uri = editor.document.uri;
            let relativePath: string | null = null;

            if (uri.scheme === 'file') {
                relativePath = vscode.workspace.asRelativePath(uri, false);
            } else if (uri.scheme === 'git') {
                // git diff view: path is like /path/to/file.ts
                relativePath = vscode.workspace.asRelativePath(vscode.Uri.file(uri.path), false);
            }

            if (relativePath) {
                if (relativePath) {
                    if (relativePath) {
                        this.callWebviewMethod('activeFileChange', { path: relativePath }).catch(() => { });
                    }
                }
            }
        });

        webviewView.onDidDispose(() => {
            activeEditorListener.dispose();
        });


        webviewView.webview.onDidReceiveMessage(async (data: { type: string; command?: string;[key: string]: any }) => {
            if (!this.gitService) {
                return;
            }

            const msg = { ...data, type: data.command || data.type };

            // Handle RPC messages
            if (msg.type === 'rpc-request' || msg.type === 'rpc-response') {
                this._rpc?.handleMessage(msg);
                return;
            }

            // Legacy message handling removed/reduced. 
            // Most logic is now in RPC handlers.
        });
    } // Close resolveWebviewView

    // Public RPC helper
    public async callWebviewMethod<K extends keyof WebviewMethods>(method: K, params?: any): Promise<ReturnType<WebviewMethods[K]>> {
        if (!this._rpc) {
            throw new Error('RPC not initialized');
        }
        // Force cast to any to allow calling "remote" methods which are part of the union type
        return (this._rpc as any).call(method, params);
    }

    // State to track if we have already populated the rebase message for the current session
    private _lastRebaseStatus: string | undefined;

    private async _getCommitStateData(): Promise<CommitState> {
        if (!this.gitService) {
            return {
                changelists: [],
                branches: { current: '', all: [] },
                incomingCommits: 0,
                stashList: []
            };
        }

        const files = await this.gitService.getStatus();
        const branches = await this._getBranchInfo();
        const incomingCommits = await this.gitService.getIncomingCommitsCount();
        const stashList = await this.gitService.getStashList();

        // Create changelist groups logic... (Moved from original refresh)
        // Conflict Group
        const conflictedFiles = files.filter(f => f.status === 'C' || f.status === 'U');
        // Tracked Group
        const trackedFiles = files.filter(f => f.status !== '?' && f.status !== 'C' && f.status !== 'U');
        // Untracked Group
        const untrackedFiles = files.filter(f => f.status === '?');

        const changelists: ChangelistGroup[] = [];

        if (conflictedFiles.length > 0) {
            changelists.push({
                id: 'merge-conflicts',
                name: 'Merge Conflicts',
                isDefault: false,
                items: conflictedFiles.map(f => ({ path: f.path, status: f.status, staged: f.staged }))
            });
        }

        if (trackedFiles.length > 0) {
            const userChangelists = await this.changelistService.getChangelists();
            const filesByChangelist = new Map<string, typeof trackedFiles>();

            for (const file of trackedFiles) {
                const listId = this.changelistService.getChangelistForFile(file.path);
                if (!filesByChangelist.has(listId)) {
                    filesByChangelist.set(listId, []);
                }
                filesByChangelist.get(listId)!.push(file);
            }

            for (const cl of userChangelists) {
                const clFiles = filesByChangelist.get(cl.id) || [];
                if (clFiles.length > 0) {
                    changelists.push({
                        id: cl.id,
                        name: cl.name,
                        isDefault: cl.isDefault,
                        items: clFiles.map(f => ({ path: f.path, status: f.status, staged: f.staged }))
                    });
                }
            }
        }

        if (untrackedFiles.length > 0) {
            changelists.push({
                id: 'unversioned',
                name: 'Unversioned Files',
                isDefault: false,
                items: untrackedFiles.map(f => ({ path: f.path, status: f.status, staged: f.staged }))
            });
        }

        if (changelists.length === 0) {
            changelists.push({
                id: 'default',
                name: 'Default Changelist',
                isDefault: true,
                items: []
            });
        }

        // Rebase message handling logic
        const rebaseStatus = branches.rebaseStatus;
        let recentCommitMessage = undefined;

        // Logic for rebase message population
        const shouldUpdateMessage = (rebaseStatus && rebaseStatus !== 'none') &&
            (this._lastRebaseStatus !== rebaseStatus);

        if (shouldUpdateMessage) {
            recentCommitMessage = await this.gitService.getRebaseCommitMessage();
        }
        this._lastRebaseStatus = rebaseStatus;

        return {
            changelists,
            branches,
            incomingCommits,
            stashList,
            recentCommitMessage
        };
    }

    private async _getChangelistsData(): Promise<ChangelistGroup[]> {
        if (!this.gitService) {
            return [];
        }

        const files = await this.gitService.getStatus();

        const conflictedFiles = files.filter(f => f.status === 'C' || f.status === 'U');
        const trackedFiles = files.filter(f => f.status !== '?' && f.status !== 'C' && f.status !== 'U');
        const untrackedFiles = files.filter(f => f.status === '?');

        const changelists: ChangelistGroup[] = [];

        if (conflictedFiles.length > 0) {
            changelists.push({
                id: 'merge-conflicts',
                name: 'Merge Conflicts',
                isDefault: false,
                items: conflictedFiles.map(f => ({ path: f.path, status: f.status, staged: f.staged }))
            });
        }

        if (trackedFiles.length > 0) {
            const userChangelists = await this.changelistService.getChangelists();
            const filesByChangelist = new Map<string, typeof trackedFiles>();

            for (const file of trackedFiles) {
                const listId = this.changelistService.getChangelistForFile(file.path);
                if (!filesByChangelist.has(listId)) {
                    filesByChangelist.set(listId, []);
                }
                filesByChangelist.get(listId)!.push(file);
            }

            for (const cl of userChangelists) {
                const clFiles = filesByChangelist.get(cl.id) || [];
                if (clFiles.length > 0) {
                    changelists.push({
                        id: cl.id,
                        name: cl.name,
                        isDefault: cl.isDefault,
                        items: clFiles.map(f => ({ path: f.path, status: f.status, staged: f.staged }))
                    });
                }
            }
        }

        if (untrackedFiles.length > 0) {
            changelists.push({
                id: 'unversioned',
                name: 'Unversioned Files',
                isDefault: false,
                items: untrackedFiles.map(f => ({ path: f.path, status: f.status, staged: f.staged }))
            });
        }

        if (changelists.length === 0) {
            changelists.push({
                id: 'default',
                name: 'Default Changelist',
                isDefault: true,
                items: []
            });
        }

        return changelists;
    }

    private async _generateCommitMessageFn(files?: string[]): Promise<string> {
        if (!this.gitService) return '';

        try {
            let diff = '';
            if (files && files.length > 0) {
                diff = await this.gitService.getDiffForFiles(files);
            } else {
                diff = await this.gitService.getStagedDiff();
            }

            if (!diff) {
                const message = files && files.length > 0
                    ? 'No changes found for selected files.'
                    : 'No staged changes to generate commit message for.';
                vscode.window.showInformationMessage(message);
                return '';
            }

            let [model] = await vscode.lm.selectChatModels({ vendor: 'copilot' });
            if (!model) {
                const models = await vscode.lm.selectChatModels();
                if (models.length > 0) model = models[0];
            }

            if (!model) {
                throw new Error('No suitable AI model found. Please ensure GitHub Copilot Chat is installed and enabled.');
            }

            const messages = [
                vscode.LanguageModelChatMessage.User('Generate a concise commit message based on the following diff. Use the conventional commits format (e.g. feat: ..., fix: ...). Only return the commit message, no explanation, no code blocks'),
                vscode.LanguageModelChatMessage.User(diff)
            ];

            const response = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);
            let fullMessage = '';

            for await (const fragment of response.text) {
                fullMessage += fragment;
            }
            return fullMessage.trim();
        } catch (e) {
            console.error('Error generating commit message:', e);
            vscode.window.showErrorMessage(`Failed to generate commit message: ${e}`);
            throw e;
        }
    }

    private async _getBranchInfo() {
        if (!this.gitService) return { current: '', all: [] };

        const branches = await this.gitService.getBranches();
        const branchStatus = await this.gitService.getBranchStatus();
        const rebaseStatus = await this.gitService.getRebaseStatus();

        return {
            current: branches.current,
            all: branches.all,
            ahead: branchStatus.ahead,
            behind: branchStatus.behind,
            rebaseStatus
        };
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return getWebviewHtml({
            webview,
            extensionUri: this._extensionUri,
            title: 'Commit'
        });
    }

    public refresh() {
        this._rpc?.proxy.refresh();
    }
}
