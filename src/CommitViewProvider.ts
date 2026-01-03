import * as vscode from 'vscode';
import { GitService } from './services/GitService';
import { ChangelistService } from './services/ChangelistService';
import type { ExtensionMethods, WebviewMethods } from '../shared/messages';
import { RpcPeer } from '../shared/rpc';
import { getWebviewHtml } from './utils/webviewHtml';
import { createRpc, ExtensionRpcHandler } from './utils/rpcHelper';

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
            changelistService: this.changelistService
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
                this._rpc?.proxy.activeFileChange({ path: relativePath });
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
