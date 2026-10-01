import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import type { ChangelistFileSelection, CommitAiAction, FileDiagnosticsChange, RefreshEvent } from '@shared/messages';
import { BaseWebviewProvider, WebviewProviderOptions } from './BaseWebviewProvider';
import { openConflictFile } from './ConflictResolverPanel';
import type { ExtensionRpcHandlerOptions } from '../rpc';

export class CommitViewProvider extends BaseWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'intelliGitView';
    private _view?: vscode.WebviewView;
    private _selectedChangelistFile: ChangelistFileSelection | null = null;
    private _isChangelistTreeFocused = false;
    private _pendingRefresh?: RefreshEvent;
    private _refreshTimeout?: NodeJS.Timeout;
    private readonly cacheSessionId = randomUUID();

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

    public triggerCommitAiAction(action: CommitAiAction) {
        if (this._view) {
            this._view.show();
            this._rpc?.proxy.triggerCommitAiAction(action);
        }
    }

    protected getInitialRoute(): string | undefined {
        return undefined;
    }

    protected getInitialState(): unknown {
        return {
            activeRepoPath: this.options.repositoryManager.getActiveRepoPath(),
            cacheSessionId: this.cacheSessionId,
        };
    }

    public requestRefresh(event: RefreshEvent): void {
        const scopes = new Set([...(this._pendingRefresh?.scopes || []), ...event.scopes]);
        const reasons = new Set(
            [...(this._pendingRefresh?.reason?.split(',') || []), ...(event.reason?.split(',') || [])].filter(Boolean)
        );
        this._pendingRefresh = {
            scopes: Array.from(scopes),
            reason: Array.from(reasons).join(','),
        };

        if (!this.isVisible() || this._refreshTimeout) {
            return;
        }

        this._refreshTimeout = setTimeout(() => this.flushRefresh(), 100);
    }

    public sendFileDiagnosticsChange(change: FileDiagnosticsChange): void {
        if (this.isVisible()) {
            void this._rpc?.proxy.fileDiagnosticsChange(change);
        }
    }

    public isVisible(): boolean {
        return this._view?.visible === true;
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

    protected getRpcHandlerOptions(): Partial<ExtensionRpcHandlerOptions> {
        return {
            onChangelistSelectionChange: (selection) => {
                this._selectedChangelistFile = selection;
                void vscode.commands.executeCommand(
                    'setContext',
                    'intelli-git.hasSelectedChangelistFile',
                    Boolean(selection?.path)
                );
            },
            onChangelistFocusChange: (focused) => {
                this._isChangelistTreeFocused = focused;
                void vscode.commands.executeCommand('setContext', 'intelli-git.changelistTreeFocus', focused);
            },
            openConflictResolver: (file) => {
                void openConflictFile(this.options, file);
            },
        };
    }

    public getSelectedChangelistFile(): ChangelistFileSelection | null {
        return this._selectedChangelistFile;
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

        this.setupActiveFileListener();

        webviewView.onDidDispose(() => {
            this._view = undefined;
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

    public override dispose(): void {
        if (this._refreshTimeout) {
            clearTimeout(this._refreshTimeout);
            this._refreshTimeout = undefined;
        }
        super.dispose();
    }
}
