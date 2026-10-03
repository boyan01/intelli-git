import * as vscode from 'vscode';
import type { ExtensionMethods, WebviewMethods } from '@shared/messages';
import { RpcPeer } from '@shared/rpc';
import { RepositoryManager } from '../services/RepositoryManager';
import type { FileIconThemeService } from '../services/FileIconThemeService';
import { getWebviewHtml } from '../utils/webviewHtml';
import { createRpc, ExtensionRpcHandler, type ExtensionRpcHandlerOptions } from '../rpc';

export interface WebviewProviderOptions {
    extensionUri: vscode.Uri;
    context: vscode.ExtensionContext;
    repositoryManager: RepositoryManager;
    fileIconThemeService?: FileIconThemeService;
}

/**
 * Base class for webview providers that encapsulates common webview setup logic.
 */
export abstract class BaseWebviewProvider {
    protected _rpc?: RpcPeer<WebviewMethods, ExtensionMethods>;
    protected _disposables: vscode.Disposable[] = [];

    constructor(protected readonly options: WebviewProviderOptions) {}

    /**
     * Sets up the webview with RPC and message handling.
     */
    protected setupWebview(webview: vscode.Webview, onDisposed: () => boolean): void {
        const fileIconThemeService = this.options.fileIconThemeService;
        let resourceRootsKey = this.applyWebviewOptions(webview);

        this._rpc = createRpc({ webview, onDisposed });

        const handler = new ExtensionRpcHandler({
            context: this.options.context,
            repositoryManager: this.options.repositoryManager,
            onDispose: this.getOnDispose(),
            getFileIconTheme: fileIconThemeService ? () => fileIconThemeService.getTheme(webview) : undefined,
            ...this.getRpcHandlerOptions(),
        });
        handler.registerAll(this._rpc);

        this._disposables.push(
            webview.onDidReceiveMessage((msg: { type: string }) => {
                this._rpc?.handleMessage(msg);
            })
        );

        if (fileIconThemeService) {
            this._disposables.push(
                fileIconThemeService.onDidChange(() => {
                    if (onDisposed()) {
                        return;
                    }
                    // A newly installed icon theme extension needs its folder added as a resource root.
                    const nextKey = this.getLocalResourceRoots()
                        .map((root) => root.toString())
                        .join('|');
                    if (nextKey !== resourceRootsKey) {
                        resourceRootsKey = this.applyWebviewOptions(webview);
                    }
                    void this._rpc?.proxy.fileIconThemeChange();
                })
            );
        }
    }

    private getLocalResourceRoots(): vscode.Uri[] {
        return [this.options.extensionUri, ...(this.options.fileIconThemeService?.getLocalResourceRoots() ?? [])];
    }

    private applyWebviewOptions(webview: vscode.Webview): string {
        const localResourceRoots = this.getLocalResourceRoots();
        webview.options = {
            enableScripts: true,
            localResourceRoots,
        };
        return localResourceRoots.map((root) => root.toString()).join('|');
    }

    protected getHtml(webview: vscode.Webview): string {
        return getWebviewHtml({
            webview,
            extensionUri: this.options.extensionUri,
            title: this.getTitle(),
            initialRoute: this.getInitialRoute(),
            initialState: this.getInitialState(),
        });
    }

    protected getOnDispose(): (() => void) | undefined {
        return undefined;
    }

    protected getRpcHandlerOptions(): Partial<ExtensionRpcHandlerOptions> {
        return {};
    }

    protected abstract getTitle(): string;
    protected abstract getInitialRoute(): string | undefined;

    protected getInitialState(): unknown | undefined {
        return undefined;
    }

    public get rpc() {
        return this._rpc?.proxy;
    }

    public dispose(): void {
        this._disposables.forEach((d) => d.dispose());
        this._disposables = [];
        this._rpc = undefined;
    }
}
