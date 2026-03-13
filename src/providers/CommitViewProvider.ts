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

    public showPushTab() {
        if (this._view) {
            this._view.show();
            this._rpc?.proxy.switchTab('push');
        }
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
            let commitHash: string | undefined = undefined;

            if (uri.scheme === 'file') {
                const wsRelPath = vscode.workspace.asRelativePath(uri, false);
                relativePath = this.gitService.toRepoPath(wsRelPath);
            } else if (uri.scheme === 'git') {
                const wsRelPath = vscode.workspace.asRelativePath(vscode.Uri.file(uri.path), false);
                relativePath = this.gitService.toRepoPath(wsRelPath);
            } else if (uri.scheme === 'intelli-git-revision') {
                // URI format: intelli-git-revision://load/{path}?{query}
                // If it's intelli-git-revision://load/path, uri.path is "/path"
                const pathPart = uri.path;
                if (pathPart.startsWith('/')) {
                    relativePath = pathPart.substring(1);
                } else {
                    relativePath = pathPart;
                }

                // Extract ref from query: ?{"ref":"..."}
                if (uri.query) {
                    try {
                        const queryParams = JSON.parse(uri.query);
                        if (queryParams.ref) {
                            commitHash = queryParams.ref;
                        }
                    } catch {
                        // Ignore parse errors
                    }
                }
            }

            if (relativePath) {
                this._rpc?.proxy.activeFileChange({ path: relativePath, commitHash });
            }
        };

        const activeEditorListener = vscode.window.onDidChangeActiveTextEditor(notifyActiveFile);

        setTimeout(() => {
            notifyActiveFile(vscode.window.activeTextEditor);
        }, 100);

        this._disposables.push(activeEditorListener);
    }
}
