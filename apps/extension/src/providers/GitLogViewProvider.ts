import * as vscode from 'vscode';
import type { GitLogRevealRequest, RefreshEvent } from '@shared/messages';
import { BaseWebviewProvider, WebviewProviderOptions } from './BaseWebviewProvider';
import type { ExtensionRpcHandlerOptions } from '../rpc';

export class GitLogViewProvider extends BaseWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'intelli-git.logView';
    private _view?: vscode.WebviewView;
    private _pendingReveal?: GitLogRevealRequest;
    private _pendingRefresh?: RefreshEvent;
    private _refreshTimeout?: NodeJS.Timeout;

    constructor(options: WebviewProviderOptions) {
        super(options);
    }

    protected getTitle(): string {
        return 'Git Log';
    }

    protected getInitialRoute(): string {
        return '/git-log';
    }

    protected getRpcHandlerOptions(): Partial<ExtensionRpcHandlerOptions> {
        return {
            consumePendingGitLogReveal: () => {
                const pendingReveal = this._pendingReveal;
                this._pendingReveal = undefined;
                return pendingReveal;
            },
        };
    }

    public requestRefresh(event: RefreshEvent): void {
        this._pendingRefresh = {
            scopes: Array.from(new Set([...(this._pendingRefresh?.scopes || []), ...event.scopes])),
            reason: [this._pendingRefresh?.reason, event.reason].filter(Boolean).join(','),
        };

        if (!this.isVisible() || this._refreshTimeout) {
            return;
        }
        this._refreshTimeout = setTimeout(() => this.flushRefresh(), 100);
    }

    private flushRefresh(): void {
        if (this._refreshTimeout) {
            clearTimeout(this._refreshTimeout);
            this._refreshTimeout = undefined;
        }
        if (!this.isVisible() || !this._pendingRefresh) {
            return;
        }
        const event = this._pendingRefresh;
        this._pendingRefresh = undefined;
        void this._rpc?.proxy.refresh(event);
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;
        this._pendingRefresh = undefined;

        this._disposables.push(
            webviewView.onDidChangeVisibility(() => {
                if (webviewView.visible) {
                    this.flushRefresh();
                }
            })
        );

        this.setupWebview(webviewView.webview, () => !this._view);
        webviewView.webview.html = this.getHtml(webviewView.webview);

        webviewView.onDidDispose(() => {
            this._view = undefined;
            this.dispose();
        });
    }

    public isVisible(): boolean {
        return this._view?.visible === true;
    }

    public async revealLog(params: GitLogRevealRequest): Promise<void> {
        this._pendingReveal = params;

        if (!this._view) {
            await vscode.commands.executeCommand('intelli-git.logView.focus');
            return;
        }

        this._view.show?.();
        this._pendingReveal = undefined;
        await this._rpc?.proxy.revealLog(params);
    }

    public async filterByBranch(branch: string): Promise<void> {
        if (!branch) return;

        this._view?.show?.();
        await this._rpc?.proxy.filterLogByBranch({ branch });
    }

    public override dispose(): void {
        if (this._refreshTimeout) {
            clearTimeout(this._refreshTimeout);
            this._refreshTimeout = undefined;
        }
        super.dispose();
    }
}
