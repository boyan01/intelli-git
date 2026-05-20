import * as vscode from 'vscode';
import type { ChangelistFileSelection } from '@shared/messages';
import { BaseWebviewProvider, WebviewProviderOptions } from './BaseWebviewProvider';
import type { ExtensionRpcHandlerOptions } from '../rpc';

export class CommitViewProvider extends BaseWebviewProvider implements vscode.WebviewViewProvider {

    public static readonly viewType = 'intelliGitView';
    private _view?: vscode.WebviewView;
    private _selectedChangelistFile: ChangelistFileSelection | null = null;
    private _isChangelistTreeFocused = false;

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

    public toggleWorktreesDrawer() {
        if (this._view) {
            this._view.show();
            this._rpc?.proxy.toggleWorktreesDrawer();
        }
    }

    protected getInitialRoute(): string | undefined {
        return undefined;
    }

    protected getRpcHandlerOptions(): Partial<ExtensionRpcHandlerOptions> {
        return {
            onChangelistSelectionChange: (selection) => {
                this._selectedChangelistFile = selection;
                void vscode.commands.executeCommand('setContext', 'intelli-git.hasSelectedChangelistFile', Boolean(selection?.path));
            },
            onChangelistFocusChange: (focused) => {
                this._isChangelistTreeFocused = focused;
                void vscode.commands.executeCommand('setContext', 'intelli-git.changelistTreeFocus', focused);
            }
        };
    }

    public getSelectedChangelistFile(): ChangelistFileSelection | null {
        return this._selectedChangelistFile;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        this.setupWebview(webviewView.webview, () => !this._view);
        webviewView.webview.html = this.getHtml(webviewView.webview);

        this.setupActiveFileListener();

        webviewView.onDidDispose(() => {
            this._selectedChangelistFile = null;
            this._isChangelistTreeFocused = false;
            void vscode.commands.executeCommand('setContext', 'intelli-git.hasSelectedChangelistFile', false);
            void vscode.commands.executeCommand('setContext', 'intelli-git.changelistTreeFocus', false);
            this.dispose();
        });
    }

    private setupActiveFileListener(): void {
        const notifyActiveFile = (editor: vscode.TextEditor | undefined) => {
            if (!editor) return;

            const uri = editor.document.uri;
            let relativePath: string | null = null;
            let commitHash: string | undefined = undefined;

            if (uri.scheme === 'file') {
                const wsRelPath = vscode.workspace.asRelativePath(uri, false);
                relativePath = this.options.repositoryManager.getActiveService()?.toRepoPath(wsRelPath) || wsRelPath;
            } else if (uri.scheme === 'git') {
                const wsRelPath = vscode.workspace.asRelativePath(vscode.Uri.file(uri.path), false);
                relativePath = this.options.repositoryManager.getActiveService()?.toRepoPath(wsRelPath) || wsRelPath;
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
