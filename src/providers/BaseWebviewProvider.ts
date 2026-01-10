import * as vscode from 'vscode';
import type { ExtensionMethods, WebviewMethods } from '../../shared/messages';
import { RpcPeer } from '../../shared/rpc';
import { GitService } from '../services/GitService';
import { ChangelistService } from '../services/ChangelistService';
import { getWebviewHtml } from '../utils/webviewHtml';
import { createRpc, ExtensionRpcHandler } from '../rpc';

export interface WebviewProviderOptions {
    extensionUri: vscode.Uri;
    context: vscode.ExtensionContext;
    gitService: GitService;
    changelistService?: ChangelistService;
}

/**
 * Base class for webview providers that encapsulates common webview setup logic.
 */
export abstract class BaseWebviewProvider {
    protected _rpc?: RpcPeer<WebviewMethods, ExtensionMethods>;
    protected _disposables: vscode.Disposable[] = [];

    constructor(protected readonly options: WebviewProviderOptions) { }

    /**
     * Sets up the webview with RPC and message handling.
     */
    protected setupWebview(webview: vscode.Webview, onDisposed: () => boolean): void {
        webview.options = {
            enableScripts: true,
            localResourceRoots: [this.options.extensionUri]
        };

        this._rpc = createRpc({ webview, onDisposed });

        const handler = new ExtensionRpcHandler({
            context: this.options.context,
            gitService: this.options.gitService,
            changelistService: this.options.changelistService,
            onDispose: this.getOnDispose()
        });
        handler.registerAll(this._rpc);

        this._disposables.push(
            webview.onDidReceiveMessage((msg: { type: string }) => {
                this._rpc?.handleMessage(msg);
            })
        );
    }

    protected getHtml(webview: vscode.Webview): string {
        return getWebviewHtml({
            webview,
            extensionUri: this.options.extensionUri,
            title: this.getTitle(),
            initialRoute: this.getInitialRoute()
        });
    }

    protected getOnDispose(): (() => void) | undefined {
        return undefined;
    }

    protected abstract getTitle(): string;
    protected abstract getInitialRoute(): string | undefined;

    public get rpc() {
        return this._rpc?.proxy;
    }

    public dispose(): void {
        this._disposables.forEach(d => d.dispose());
        this._disposables = [];
    }
}
