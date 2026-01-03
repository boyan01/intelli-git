import * as vscode from 'vscode';
import { GitService } from '../services/GitService';
import { ChangelistService } from '../services/ChangelistService';
import type { ExtensionMethods, WebviewMethods } from '../../shared/messages';
import { RpcPeer } from '../../shared/rpc';
import { getWebviewHtml } from '../utils/webviewHtml';
import { createRpc, ExtensionRpcHandler } from '../rpc';

export class GitLogViewProvider implements vscode.WebviewViewProvider {

    public static readonly viewType = 'intelli-git.logView';
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
        webviewView.onDidChangeVisibility(() => {
            // Track visibility if needed
        });

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        this._rpc = createRpc({
            webview: webviewView.webview,
            onDisposed: () => !this._view
        });

        const handler = new ExtensionRpcHandler({
            gitService: this.gitService,
            changelistService: this.changelistService
        });
        handler.registerAll(this._rpc);

        webviewView.onDidDispose(() => {
            // cleanup
        });


        webviewView.webview.onDidReceiveMessage(async (data: { type: string; command?: string;[key: string]: any }) => {
            if (!this.gitService) {
                return;
            }

            const msg = { ...data, type: data.command || data.type };

            if (msg.type === 'rpc-request' || msg.type === 'rpc-response') {
                this._rpc?.handleMessage(msg);
                return;
            }
        });
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return getWebviewHtml({
            webview,
            extensionUri: this._extensionUri,
            title: 'Git Log',
            initialRoute: '/git-log'
        });
    }

    public isVisible(): boolean {
        return this._view?.visible === true;
    }
}
