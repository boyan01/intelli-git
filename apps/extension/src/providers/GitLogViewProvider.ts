import * as vscode from 'vscode';
import type { GitLogRevealRequest } from '@shared/messages';
import { BaseWebviewProvider, WebviewProviderOptions } from './BaseWebviewProvider';
import type { ExtensionRpcHandlerOptions } from '../rpc';

export class GitLogViewProvider extends BaseWebviewProvider implements vscode.WebviewViewProvider {

    public static readonly viewType = 'intelli-git.logView';
    private _view?: vscode.WebviewView;
    private _pendingReveal?: GitLogRevealRequest;

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
            }
        };
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

        this.setupWebview(webviewView.webview, () => !this._view);
        webviewView.webview.html = this.getHtml(webviewView.webview);

        webviewView.onDidDispose(() => {
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
}
