import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import simpleGit, { type SimpleGit } from 'simple-git';
import { GitService } from './GitService';
import { InactiveChangesService } from './InactiveChangesService';
import { ChangelistStateService } from './ChangelistStateService';
import { logger } from '../utils/logger';

export interface RepositoryScope {
    name: string;
    repoPath: string;
    path: string;
    workspaceRoot: string;
    gitRoot: string;
    gitDir?: string;
    isSubmodule: boolean;
    kind: 'workspace' | 'submodule' | 'worktree';
    mainWorktreePath?: string;
    branch?: string;
    head?: string;
    isDetached?: boolean;
}

interface RepositoryEntry {
    service: GitService;
    info: RepositoryScope;
}

interface RepositoryGitState {
    head?: string;
    branch?: string;
    isDetached?: boolean;
    gitDir?: string;
}

interface WorktreeRecord {
    path: string;
    head?: string;
    branch?: string;
    isDetached?: boolean;
    isBare?: boolean;
    isPrunable?: boolean;
}

function normalizeExistingPath(filePath: string): string {
    try {
        return path.normalize(fs.realpathSync(filePath));
    } catch {
        return path.normalize(filePath);
    }
}

export class RepositoryManager implements vscode.Disposable {
    private repositories = new Map<string, RepositoryEntry>();
    private activeRepoPath: string | undefined;
    private _onDidChangeActiveRepo = new vscode.EventEmitter<string | undefined>();
    private _onDidChangeRepositories = new vscode.EventEmitter<void>();
    private disposables: vscode.Disposable[] = [];

    public readonly onDidChangeActiveRepo = this._onDidChangeActiveRepo.event;
    public readonly onDidChangeRepositories = this._onDidChangeRepositories.event;

    constructor(private context: vscode.ExtensionContext) {
        this.disposables.push(
            vscode.workspace.onDidChangeWorkspaceFolders(() => {
                this.scanRepositories().catch(e => logger.error('Failed to scan repositories after workspace change', e));
            })
        );
    }

    public async initialize(): Promise<void> {
        await this.scanRepositories();
    }

    private async scanRepositories() {
        const workspaceFolders = vscode.workspace.workspaceFolders || [];
        const newRepos = new Map<string, RepositoryScope>();
        let globalStateMigrationRepoPath: string | undefined;

        for (const [index, folder] of workspaceFolders.entries()) {
            const folderPath = normalizeExistingPath(folder.uri.fsPath);
            try {
                const git = simpleGit(folderPath);
                const isRepo = await git.checkIsRepo();
                if (isRepo) {
                    const topLevel = await git.revparse(['--show-toplevel']);
                    const rootPath = normalizeExistingPath(topLevel.trim());
                    const gitState = await this.readRepositoryGitState(git, rootPath);
                    const worktreeList = await this.readWorktreeList(git, rootPath);
                    const currentWorktreeRecord = worktreeList?.records.find(record => (
                        record.path && normalizeExistingPath(record.path) === rootPath
                    ));
                    const isLinkedWorktreeRoot = Boolean(worktreeList && currentWorktreeRecord && rootPath !== worktreeList.mainWorktreePath);
                    const scope = this.createRepositoryScope({
                        workspaceRoot: folderPath,
                        gitRoot: rootPath,
                        isSubmodule: false,
                        kind: isLinkedWorktreeRoot ? 'worktree' : 'workspace',
                        mainWorktreePath: isLinkedWorktreeRoot ? worktreeList?.mainWorktreePath : undefined,
                        head: currentWorktreeRecord?.head || gitState.head,
                        branch: currentWorktreeRecord?.branch || gitState.branch,
                        isDetached: currentWorktreeRecord?.isDetached ?? gitState.isDetached,
                        gitDir: gitState.gitDir
                    });
                    newRepos.set(scope.repoPath, scope);
                    if (index === 0) {
                        globalStateMigrationRepoPath = scope.repoPath;
                    }

                    // Find submodules
                    try {
                        const submoduleStatus = await git.subModule(['status']);
                        if (submoduleStatus && typeof submoduleStatus === 'string') {
                            const lines = submoduleStatus.split('\n').filter(l => l.trim().length > 0);
                            for (const line of lines) {
                                // Output format is generally:
                                // +hash path (describe)
                                // or just: hash path (describe)
                                const parts = line.trim().split(/\s+/);
                                if (parts.length >= 2) {
                                    const subPath = parts[1];
                                    const absoluteSubPath = normalizeExistingPath(path.join(rootPath, subPath));
                                    const submoduleGit = simpleGit(absoluteSubPath);
                                    const submoduleGitState = await this.readRepositoryGitState(submoduleGit, absoluteSubPath);
                                    const submoduleScope = this.createRepositoryScope({
                                        workspaceRoot: absoluteSubPath,
                                        gitRoot: absoluteSubPath,
                                        isSubmodule: true,
                                        kind: 'submodule',
                                        ...submoduleGitState
                                    });
                                    newRepos.set(absoluteSubPath, submoduleScope);
                                }
                            }
                        }
                    } catch (e) {
                        logger.error(`Failed to get submodules for ${rootPath}`, e);
                    }

                    for (const worktreeScope of await this.discoverLinkedWorktrees(git, rootPath, worktreeList)) {
                        if (!newRepos.has(worktreeScope.repoPath)) {
                            newRepos.set(worktreeScope.repoPath, worktreeScope);
                        }
                    }
                }
            } catch (e) {
                logger.error(`Failed to check git repo for ${folderPath}`, e);
            }
        }

        let changed = false;

        // Remove removed repos
        for (const [repoPath, entry] of this.repositories.entries()) {
            if (!newRepos.has(repoPath)) {
                entry.service.dispose();
                this.repositories.delete(repoPath);
                changed = true;
            }
        }

        // Add new repos and update metadata for existing repos
        for (const [repoPath, info] of newRepos.entries()) {
            const existing = this.repositories.get(repoPath);
            if (existing) {
                if (!this.isSameScope(existing.info, info)) {
                    existing.info = info;
                    changed = true;
                }
                continue;
            }

            if (!this.repositories.has(repoPath)) {
                try {
                    const shouldMigrateGlobalState = repoPath === globalStateMigrationRepoPath;
                    const inactiveService = new InactiveChangesService(this.context, repoPath, shouldMigrateGlobalState);
                    const changelistService = new ChangelistStateService(this.context, repoPath, shouldMigrateGlobalState);
                    const gitService = await GitService.create(info.workspaceRoot, inactiveService, changelistService);
                    this.repositories.set(repoPath, { service: gitService, info });
                    changed = true;
                } catch (e) {
                    logger.error(`Failed to create GitService for ${repoPath}`, e);
                }
            }
        }

        if (changed) {
            if (!this.activeRepoPath || !this.repositories.has(this.activeRepoPath)) {
                const nextRepoPath = this.repositories.keys().next().value;
                this.activeRepoPath = nextRepoPath;
                this._onDidChangeActiveRepo.fire(this.activeRepoPath);
            }
            this._onDidChangeRepositories.fire();
        }
    }

    private async readRepositoryGitState(git: SimpleGit, baseDir: string): Promise<RepositoryGitState> {
        const state: RepositoryGitState = {};

        try {
            const head = (await git.revparse(['HEAD'])).trim();
            if (head) {
                state.head = head;
            }
        } catch {
            // An unborn repository has no HEAD commit yet.
        }

        try {
            const branch = (await git.raw(['symbolic-ref', '--short', '-q', 'HEAD'])).trim();
            if (branch) {
                state.branch = branch;
            }
        } catch {
            // Detached HEAD or no commits yet.
        }

        try {
            const gitDir = (await git.revparse(['--git-dir'])).trim();
            if (gitDir) {
                state.gitDir = normalizeExistingPath(path.isAbsolute(gitDir) ? gitDir : path.join(baseDir, gitDir));
            }
        } catch {
            // Ignore git-dir lookup failures; the repository itself was already validated.
        }

        state.isDetached = Boolean(state.head && !state.branch);
        return state;
    }

    private parseWorktreeList(output: string): WorktreeRecord[] {
        const records: WorktreeRecord[] = [];
        let current: WorktreeRecord | undefined;

        const finishRecord = () => {
            if (current) {
                records.push(current);
                current = undefined;
            }
        };

        for (const rawLine of output.split(/\r?\n/)) {
            const line = rawLine.trimEnd();
            if (!line) {
                finishRecord();
                continue;
            }

            if (line.startsWith('worktree ')) {
                finishRecord();
                current = { path: line.substring('worktree '.length) };
                continue;
            }

            if (!current) {
                continue;
            }

            if (line.startsWith('HEAD ')) {
                current.head = line.substring('HEAD '.length);
            } else if (line.startsWith('branch ')) {
                current.branch = line.substring('branch '.length).replace(/^refs\/heads\//, '');
            } else if (line === 'detached') {
                current.isDetached = true;
            } else if (line === 'bare') {
                current.isBare = true;
            } else if (line.startsWith('prunable')) {
                current.isPrunable = true;
            }
        }

        finishRecord();
        return records;
    }

    private async readWorktreeList(git: SimpleGit, rootPath: string): Promise<{ records: WorktreeRecord[]; mainWorktreePath: string } | undefined> {
        let output: string;
        try {
            output = await git.raw(['worktree', 'list', '--porcelain']);
        } catch (e) {
            logger.debug(`Failed to list worktrees for ${rootPath}`, e);
            return undefined;
        }

        const records = this.parseWorktreeList(output);
        const mainWorktreePath = records[0]?.path ? normalizeExistingPath(records[0].path) : rootPath;
        return { records, mainWorktreePath };
    }

    private async discoverLinkedWorktrees(
        git: SimpleGit,
        rootPath: string,
        worktreeList?: { records: WorktreeRecord[]; mainWorktreePath: string }
    ): Promise<RepositoryScope[]> {
        const list = worktreeList ?? await this.readWorktreeList(git, rootPath);
        if (!list) {
            return [];
        }

        const { records, mainWorktreePath } = list;
        const scopes: RepositoryScope[] = [];

        for (const record of records) {
            if (!record.path || record.isBare || record.isPrunable) {
                continue;
            }

            const worktreePath = normalizeExistingPath(record.path);
            if (worktreePath === rootPath || !fs.existsSync(worktreePath)) {
                continue;
            }

            try {
                const worktreeGit = simpleGit(worktreePath);
                if (!await worktreeGit.checkIsRepo()) {
                    continue;
                }

                const topLevel = normalizeExistingPath((await worktreeGit.revparse(['--show-toplevel'])).trim());
                if (topLevel !== worktreePath) {
                    continue;
                }

                const gitState = await this.readRepositoryGitState(worktreeGit, worktreePath);
                const kind: RepositoryScope['kind'] = worktreePath === mainWorktreePath ? 'workspace' : 'worktree';
                scopes.push(this.createRepositoryScope({
                    workspaceRoot: worktreePath,
                    gitRoot: worktreePath,
                    isSubmodule: false,
                    kind,
                    mainWorktreePath: kind === 'worktree' ? mainWorktreePath : undefined,
                    head: record.head || gitState.head,
                    branch: record.branch || gitState.branch,
                    isDetached: record.isDetached ?? gitState.isDetached,
                    gitDir: gitState.gitDir
                }));
            } catch (e) {
                logger.debug(`Ignoring unavailable worktree ${worktreePath}`, e);
            }
        }

        return scopes;
    }

    private createRepositoryScope(input: {
        workspaceRoot: string;
        gitRoot: string;
        gitDir?: string;
        isSubmodule: boolean;
        kind: RepositoryScope['kind'];
        mainWorktreePath?: string;
        branch?: string;
        head?: string;
        isDetached?: boolean;
    }): RepositoryScope {
        const repoPath = normalizeExistingPath(input.workspaceRoot);
        const gitRoot = normalizeExistingPath(input.gitRoot);
        return {
            name: path.basename(repoPath),
            repoPath,
            path: repoPath,
            workspaceRoot: repoPath,
            gitRoot,
            gitDir: input.gitDir,
            isSubmodule: input.isSubmodule,
            kind: input.kind,
            mainWorktreePath: input.mainWorktreePath,
            branch: input.branch,
            head: input.head,
            isDetached: input.isDetached
        };
    }

    private isSameScope(a: RepositoryScope, b: RepositoryScope): boolean {
        return a.name === b.name
            && a.repoPath === b.repoPath
            && a.path === b.path
            && a.workspaceRoot === b.workspaceRoot
            && a.gitRoot === b.gitRoot
            && a.gitDir === b.gitDir
            && a.isSubmodule === b.isSubmodule
            && a.kind === b.kind
            && a.mainWorktreePath === b.mainWorktreePath
            && a.branch === b.branch
            && a.head === b.head
            && a.isDetached === b.isDetached;
    }

    public getActiveService(): GitService | undefined {
        if (this.activeRepoPath) {
            return this.repositories.get(this.activeRepoPath)?.service;
        }
        return undefined;
    }

    public getService(repoPath: string | undefined): GitService | undefined {
        if (!repoPath) {
            return undefined;
        }
        return this.repositories.get(normalizeExistingPath(repoPath))?.service;
    }

    public getActiveRepoPath(): string | undefined {
        return this.activeRepoPath;
    }

    public getActiveScope(): RepositoryScope | undefined {
        if (!this.activeRepoPath) {
            return undefined;
        }
        return this.repositories.get(this.activeRepoPath)?.info;
    }

    public getRepositories(): RepositoryScope[] {
        const repos = Array.from(this.repositories.values()).map(entry => entry.info);
        const kindOrder: Record<RepositoryScope['kind'], number> = {
            workspace: 0,
            worktree: 1,
            submodule: 2
        };

        return repos.sort((a, b) => {
            if (a.kind !== b.kind) {
                return kindOrder[a.kind] - kindOrder[b.kind];
            }
            return a.name.localeCompare(b.name);
        });
    }

    public setActiveRepository(repoPath: string): boolean {
        if (this.repositories.has(repoPath) && this.activeRepoPath !== repoPath) {
            this.activeRepoPath = repoPath;
            this._onDidChangeActiveRepo.fire(repoPath);
            return true;
        }
        return false;
    }

    public getAllServices(): GitService[] {
        return Array.from(this.repositories.values()).map(entry => entry.service);
    }

    public dispose() {
        for (const entry of this.repositories.values()) {
            entry.service.dispose();
        }
        this.repositories.clear();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }
}
