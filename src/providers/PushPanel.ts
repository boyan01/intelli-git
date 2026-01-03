import * as vscode from 'vscode';
import { GitService } from '../services/GitService';
import type { ExtensionMethods, WebviewMethods } from '../../shared/messages';
import { RpcPeer } from '../../shared/rpc';
import { getWebviewHtml } from '../utils/webviewHtml';
import { createRpc, ExtensionRpcHandler } from '../rpc';

export class PushPanel {
    public static currentPanel: PushPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _gitService: GitService;
    private _rpc?: RpcPeer<WebviewMethods, ExtensionMethods>;
    private _disposables: vscode.Disposable[] = [];
    private _disposed: boolean = false;

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        gitService: GitService
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._gitService = gitService;

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._rpc = createRpc({
            webview: this._panel.webview,
            onDisposed: () => this._disposed
        });

        const handler = new ExtensionRpcHandler({
            gitService: this._gitService,
            onDispose: () => this.dispose()
        });
        handler.registerAll(this._rpc);

        this._panel.webview.onDidReceiveMessage(
            async (message: { type: string;[key: string]: any }) => {
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
            'intelliGitPushPanel',
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
        this._disposed = true;
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

    private _getHtmlForWebview() {
        return getWebviewHtml({
            webview: this._panel.webview,
            extensionUri: this._extensionUri,
            title: 'Push Commits',
            initialRoute: '/push'
        });
    }
}
