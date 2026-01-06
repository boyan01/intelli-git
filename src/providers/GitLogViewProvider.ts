import * as vscode from 'vscode';
import { BaseWebviewProvider, WebviewProviderOptions } from './BaseWebviewProvider';

export class GitLogViewProvider extends BaseWebviewProvider implements vscode.WebviewViewProvider {

    public static readonly viewType = 'intelli-git.logView';
    private _view?: vscode.WebviewView;

    constructor(options: WebviewProviderOptions) {
        super(options);
    }

    protected getTitle(): string {
        return 'Git Log';
    }

    protected getInitialRoute(): string {
        return '/git-log';
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
}
