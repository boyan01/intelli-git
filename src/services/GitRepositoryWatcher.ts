import * as vscode from 'vscode';
import * as path from 'path';
import { log } from '../utils/logger';

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

/**
 * Watches Git state changes using VS Code's built-in Git extension API.
 * This is the preferred watcher as it captures all Git changes including CLI.
 */
export class VSCodeGitWatcher implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];
    private refreshTimeout?: NodeJS.Timeout;
    private onChangeEmitter = new vscode.EventEmitter<void>();
    private _isActive = false;

    public readonly onChange = this.onChangeEmitter.event;

    /**
     * Returns true if the watcher is active (VS Code Git extension is available).
     */
    public get isActive(): boolean {
        return this._isActive;
    }

    constructor(context: vscode.ExtensionContext) {
        this.disposables.push(this.onChangeEmitter);
        this.initialize(context);
    }

    private async initialize(context: vscode.ExtensionContext) {
        const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
        if (!gitExtension) {
            log('VS Code Git extension not found, will use fallback watcher');
            return;
        }

        try {
            const git = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
            const api = git.getAPI(1);

            // Watch existing repositories
            for (const repo of api.repositories) {
                this.disposables.push(repo.state.onDidChange(() => this.scheduleRefresh()));
            }

            // Watch for new repositories
            this.disposables.push(
                api.onDidOpenRepository(repo => {
                    this.disposables.push(repo.state.onDidChange(() => this.scheduleRefresh()));
                })
            );

            this._isActive = true;
            log('VSCodeGitWatcher initialized successfully');
        } catch (e) {
            log('Failed to initialize VSCodeGitWatcher:', e);
        }
    }

    private scheduleRefresh() {
        if (this.refreshTimeout) {
            clearTimeout(this.refreshTimeout);
        }
        this.refreshTimeout = setTimeout(() => {
            this.onChangeEmitter.fire();
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
    private onChangeEmitter = new vscode.EventEmitter<void>();

    public readonly onChange = this.onChangeEmitter.event;

    constructor(workspaceRoot: string) {
        // Watch all files including .git directory
        const watcher = vscode.workspace.createFileSystemWatcher('**/*');
        watcher.onDidChange(this.handleChange);
        watcher.onDidCreate(this.handleChange);
        watcher.onDidDelete(this.handleChange);
        this.disposables.push(watcher);

        this.disposables.push(this.onChangeEmitter);
        log('FileSystemGitWatcher initialized as fallback');
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
        this.scheduleRefresh();
    };

    private scheduleRefresh() {
        if (this.refreshTimeout) {
            clearTimeout(this.refreshTimeout);
        }
        this.refreshTimeout = setTimeout(() => {
            this.onChangeEmitter.fire();
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
    context: vscode.ExtensionContext,
    workspaceRoot: string
): Promise<vscode.Disposable & { onChange: vscode.Event<void> }> {
    const vsCodeWatcher = new VSCodeGitWatcher(context);

    // Wait a bit for async initialization
    await new Promise(resolve => setTimeout(resolve, 100));

    if (vsCodeWatcher.isActive) {
        return vsCodeWatcher;
    }

    // Fallback to FileSystemWatcher
    vsCodeWatcher.dispose();
    return new FileSystemGitWatcher(workspaceRoot);
}
