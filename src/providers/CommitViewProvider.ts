import * as vscode from 'vscode';
import { BaseWebviewProvider, WebviewProviderOptions } from './BaseWebviewProvider';

export class CommitViewProvider extends BaseWebviewProvider implements vscode.WebviewViewProvider {

    public static readonly viewType = 'intelliGitView';
    private _view?: vscode.WebviewView;

    constructor(options: WebviewProviderOptions) {
        super(options);
    }

    protected getTitle(): string {
        return 'Commit';
    }

    protected getInitialRoute(): string | undefined {
        return undefined;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        this.setupWebview(webviewView.webview, () => !this._view);
        webviewView.webview.html = this.getHtml(webviewView.webview);

        this.setupActiveFileListener(webviewView);

        webviewView.onDidDispose(() => {
            this.dispose();
        });
    }

    private setupActiveFileListener(webviewView: vscode.WebviewView): void {
        const notifyActiveFile = (editor: vscode.TextEditor | undefined) => {
            if (!editor) return;

            const uri = editor.document.uri;
            let relativePath: string | null = null;

            if (uri.scheme === 'file') {
                relativePath = vscode.workspace.asRelativePath(uri, false);
            } else if (uri.scheme === 'git') {
                relativePath = vscode.workspace.asRelativePath(vscode.Uri.file(uri.path), false);
            }

            if (relativePath) {
                this._rpc?.proxy.activeFileChange({ path: relativePath });
            }
        };

        const activeEditorListener = vscode.window.onDidChangeActiveTextEditor(notifyActiveFile);

        setTimeout(() => {
            notifyActiveFile(vscode.window.activeTextEditor);
        }, 100);

        this._disposables.push(activeEditorListener);
    }

    public refresh() {
        this._rpc?.proxy.refresh();
    }
}
