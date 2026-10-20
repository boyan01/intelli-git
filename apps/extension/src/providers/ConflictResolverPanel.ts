import * as vscode from 'vscode';
import * as path from 'path';
import type {
    ConflictResolverContextActionRequest,
    ConflictResolverOpenRequest,
    RepositoryFileReference,
} from '@shared/messages';
import { BaseWebviewProvider, WebviewProviderOptions } from './BaseWebviewProvider';

function getPanelKey(file: RepositoryFileReference): string {
    return `${file.repoPath || ''}:${file.path}`;
}

export async function openConflictFile(
    options: WebviewProviderOptions,
    file: ConflictResolverOpenRequest
): Promise<void> {
    const enabled = vscode.workspace.getConfiguration('intelli-git.mergeEditor').get<boolean>('enabled', false);

    if (enabled) {
        ConflictResolverPanel.createOrShow(options, file);
        return;
    }

    const repoPath = file.repoPath || options.repositoryManager.getActiveService()?.getWorkspaceRoot();
    if (!repoPath) {
        return;
    }

    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(path.join(repoPath, file.path)));
}

export class ConflictResolverPanel extends BaseWebviewProvider {
    private static panels = new Map<string, ConflictResolverPanel>();
    private key: string;
    private disposed = false;

    private constructor(
        private readonly panel: vscode.WebviewPanel,
        options: WebviewProviderOptions,
        private readonly file: ConflictResolverOpenRequest
    ) {
        super(options);
        this.key = getPanelKey(file);
        this.panel.iconPath = new vscode.ThemeIcon('intelli-git-merge');

        this.panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this.setupWebview(this.panel.webview, () => this.disposed);
        this.panel.webview.html = this.getHtml(this.panel.webview);
    }

    protected getTitle(): string {
        return `Merge: ${path.basename(this.file.path)}`;
    }

    protected getInitialRoute(): string {
        return '/conflict-resolver';
    }

    protected getInitialState(): unknown {
        const conflictFile: RepositoryFileReference = {
            path: this.file.path,
            repoPath: this.file.repoPath,
        };

        return {
            conflictFile,
        };
    }

    protected getOnDispose(): () => void {
        return () => this.dispose();
    }

    protected getRpcHandlerOptions() {
        return {
            updateConflictResolverTitle: (file: RepositoryFileReference) => {
                this.updateActiveFile(file);
            },
        };
    }

    private updateActiveFile(file: RepositoryFileReference): void {
        if (this.disposed) {
            return;
        }

        const nextKey = getPanelKey(file);
        this.panel.title = `Merge: ${path.basename(file.path)}`;

        if (nextKey === this.key) {
            return;
        }

        if (ConflictResolverPanel.panels.get(this.key) === this) {
            ConflictResolverPanel.panels.delete(this.key);
        }

        const existing = ConflictResolverPanel.panels.get(nextKey);
        if (existing && existing !== this) {
            existing.dispose();
        }

        this.key = nextKey;
        ConflictResolverPanel.panels.set(nextKey, this);
    }

    public static dispatchContextAction(request: ConflictResolverContextActionRequest): void {
        const panel = ConflictResolverPanel.panels.get(getPanelKey(request));
        if (!panel || panel.disposed) {
            return;
        }
        void panel.rpc?.triggerConflictResolverAction(request);
    }

    public static createOrShow(options: WebviewProviderOptions, file: ConflictResolverOpenRequest): void {
        const key = getPanelKey(file);
        const existing = ConflictResolverPanel.panels.get(key);
        if (existing) {
            existing.updateActiveFile(file);
            existing.panel.reveal(vscode.ViewColumn.Active);
            void existing.rpc?.revealConflictResolverFile(file);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'intelliGitConflictResolver',
            `Merge: ${path.basename(file.path)}`,
            {
                viewColumn: vscode.ViewColumn.Active,
                preserveFocus: false,
            },
            {
                enableScripts: true,
                localResourceRoots: [options.extensionUri],
                retainContextWhenHidden: true,
            }
        );

        const resolver = new ConflictResolverPanel(panel, options, file);
        ConflictResolverPanel.panels.set(key, resolver);
    }

    public dispose(): void {
        if (this.disposed) {
            return;
        }

        this.disposed = true;
        if (ConflictResolverPanel.panels.get(this.key) === this) {
            ConflictResolverPanel.panels.delete(this.key);
        }
        this.panel.dispose();
        super.dispose();
    }
}
