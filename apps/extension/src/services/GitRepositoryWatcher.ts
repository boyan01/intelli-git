import * as vscode from 'vscode';
import { logger } from '../utils/logger';

// Types for VS Code Git extension API
interface GitExtension {
    getAPI(version: 1): GitAPI;
}

interface GitAPI {
    repositories: Repository[];
    onDidOpenRepository: vscode.Event<Repository>;
}

interface Repository {
    state: RepositoryState;
}

interface RepositoryState {
    onDidChange: vscode.Event<void>;
}

export interface GitWatcherChange {
    kind: 'state' | 'repositories';
}

/**
 * Watches Git state changes using VS Code's built-in Git extension API.
 * This is the preferred watcher as it captures all Git changes including CLI.
 */
export class VSCodeGitWatcher implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];
    private refreshTimeout?: NodeJS.Timeout;
    private onChangeEmitter = new vscode.EventEmitter<GitWatcherChange>();
    private _isActive = false;

    public readonly onChange = this.onChangeEmitter.event;

    /**
     * Returns true if the watcher is active (VS Code Git extension is available).
     */
    public get isActive(): boolean {
        return this._isActive;
    }

    constructor() {
        this.disposables.push(this.onChangeEmitter);
        this.initialize();
    }

    private async initialize() {
        const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
        if (!gitExtension) {
            logger.info('VS Code Git extension not found, will use fallback watcher');
            return;
        }

        try {
            const git = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
            const api = git.getAPI(1);

            // Watch existing repositories
            for (const repo of api.repositories) {
                this.disposables.push(repo.state.onDidChange(() => this.scheduleRefresh('state')));
            }

            // Watch for new repositories
            this.disposables.push(
                api.onDidOpenRepository(repo => {
                    this.disposables.push(repo.state.onDidChange(() => this.scheduleRefresh('state')));
                    this.scheduleRefresh('repositories');
                })
            );

            this._isActive = true;
            logger.info('VSCodeGitWatcher initialized successfully');
        } catch (e) {
            logger.info('Failed to initialize VSCodeGitWatcher:', e);
        }
    }

    private pendingKind: GitWatcherChange['kind'] = 'state';

    private scheduleRefresh(kind: GitWatcherChange['kind']) {
        if (kind === 'repositories') {
            this.pendingKind = kind;
        }
        if (this.refreshTimeout) {
            clearTimeout(this.refreshTimeout);
        }
        this.refreshTimeout = setTimeout(() => {
            const pendingKind = this.pendingKind;
            this.pendingKind = 'state';
            this.onChangeEmitter.fire({ kind: pendingKind });
        }, 200);
    }

    dispose() {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        if (this.refreshTimeout) {
            clearTimeout(this.refreshTimeout);
        }
    }
}

class CompositeGitWatcher implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];
    private onChangeEmitter = new vscode.EventEmitter<GitWatcherChange>();
    private refreshTimeout?: NodeJS.Timeout;
    private pendingKind: GitWatcherChange['kind'] = 'state';

    public readonly onChange = this.onChangeEmitter.event;

    constructor(watchers: Array<vscode.Disposable & { onChange: vscode.Event<GitWatcherChange> }>) {
        this.disposables.push(this.onChangeEmitter);
        for (const watcher of watchers) {
            this.disposables.push(
                watcher.onChange(change => this.scheduleRefresh(change)),
                watcher
            );
        }
    }

    private scheduleRefresh(change: GitWatcherChange): void {
        if (change.kind === 'repositories') {
            this.pendingKind = change.kind;
        }
        if (this.refreshTimeout) {
            clearTimeout(this.refreshTimeout);
        }
        this.refreshTimeout = setTimeout(() => {
            const pendingKind = this.pendingKind;
            this.pendingKind = 'state';
            this.onChangeEmitter.fire({ kind: pendingKind });
        }, 200);
    }

    dispose() {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        if (this.refreshTimeout) {
            clearTimeout(this.refreshTimeout);
        }
    }
}

/**
 * Fallback watcher using FileSystemWatcher.
 * Used when VS Code Git extension is not available.
 */
export class FileSystemGitWatcher implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];
    private refreshTimeout?: NodeJS.Timeout;
    private onChangeEmitter = new vscode.EventEmitter<GitWatcherChange>();
    private pendingKind: GitWatcherChange['kind'] = 'state';

    public readonly onChange = this.onChangeEmitter.event;

    constructor(workspaceRoots: string[]) {
        const patterns = workspaceRoots.length > 0
            ? workspaceRoots.map(root => new vscode.RelativePattern(root, '**/*'))
            : ['**/*'];

        for (const pattern of patterns) {
            const watcher = vscode.workspace.createFileSystemWatcher(pattern);
            watcher.onDidChange(this.handleChange);
            watcher.onDidCreate(this.handleChange);
            watcher.onDidDelete(this.handleChange);
            this.disposables.push(watcher);
        }

        this.disposables.push(this.onChangeEmitter);
        logger.info('FileSystemGitWatcher initialized as fallback');
    }

    private handleChange = (uri: vscode.Uri) => {
        // Ignore .git/objects directory (frequent temporary object changes)
        if (uri.path.includes('/.git/objects/')) {
            return;
        }
        // Ignore lock files
        if (uri.path.endsWith('.lock')) {
            return;
        }
        const gitPath = uri.path.replace(/\\/g, '/');
        const kind = /\/\.git\/(?:HEAD|config|commondir|gitdir|worktrees)(?:\/|$)/.test(gitPath)
            ? 'repositories'
            : 'state';
        this.scheduleRefresh(kind);
    };

    private scheduleRefresh(kind: GitWatcherChange['kind']) {
        if (kind === 'repositories') {
            this.pendingKind = kind;
        }
        if (this.refreshTimeout) {
            clearTimeout(this.refreshTimeout);
        }
        this.refreshTimeout = setTimeout(() => {
            const pendingKind = this.pendingKind;
            this.pendingKind = 'state';
            this.onChangeEmitter.fire({ kind: pendingKind });
        }, 200);
    }

    dispose() {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        if (this.refreshTimeout) {
            clearTimeout(this.refreshTimeout);
        }
    }
}

/**
 * Creates the best available Git watcher.
 * Tries VSCodeGitWatcher first, falls back to FileSystemGitWatcher.
 */
export async function createGitWatcher(
    _context: vscode.ExtensionContext,
    workspaceRoots: string[],
    additionalRoots: string[] = []
): Promise<vscode.Disposable & { onChange: vscode.Event<GitWatcherChange> }> {
    const vsCodeWatcher = new VSCodeGitWatcher();

    // Wait a bit for async initialization
    await new Promise(resolve => setTimeout(resolve, 100));

    if (vsCodeWatcher.isActive) {
        if (additionalRoots.length > 0) {
            return new CompositeGitWatcher([
                vsCodeWatcher,
                new FileSystemGitWatcher(additionalRoots)
            ]);
        }
        return vsCodeWatcher;
    }

    // Fallback to FileSystemWatcher
    vsCodeWatcher.dispose();
    return new FileSystemGitWatcher(Array.from(new Set([...workspaceRoots, ...additionalRoots])));
}
