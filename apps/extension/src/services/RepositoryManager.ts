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
    private static readonly USER_REPOSITORIES_KEY = 'ideaCommitPanel.userRepositories.v1';
    private static readonly HIDDEN_REPOSITORIES_KEY = 'ideaCommitPanel.hiddenRepositories.v1';
    private static readonly ACTIVE_REPOSITORY_KEY = 'ideaCommitPanel.activeRepository.v1';

    private repositories = new Map<string, RepositoryEntry>();
    private activeRepoPath: string | undefined;
    private _onDidChangeActiveRepo = new vscode.EventEmitter<string | undefined>();
    private _onDidChangeRepositories = new vscode.EventEmitter<void>();
    private _onDidFallbackActiveRepo = new vscode.EventEmitter<{ previousRepoPath: string; nextRepoPath?: string }>();
    private disposables: vscode.Disposable[] = [];
    private initializeInFlight?: Promise<void>;
    private initializePending = false;

    public readonly onDidChangeActiveRepo = this._onDidChangeActiveRepo.event;
    public readonly onDidChangeRepositories = this._onDidChangeRepositories.event;
    public readonly onDidFallbackActiveRepo = this._onDidFallbackActiveRepo.event;

    constructor(private context: vscode.ExtensionContext) {
        this.disposables.push(
            vscode.workspace.onDidChangeWorkspaceFolders(() => {
                this.initialize().catch(e => logger.error('Failed to scan repositories after workspace change', e));
            })
        );
    }

    public initialize(): Promise<void> {
        if (this.initializeInFlight) {
            this.initializePending = true;
            return this.initializeInFlight;
        }

        const run = async () => {
            do {
                this.initializePending = false;
                await this.scanRepositories();
            } while (this.initializePending);
        };
        const request = run().finally(() => {
            if (this.initializeInFlight === request) {
                this.initializeInFlight = undefined;
            }
        });
        this.initializeInFlight = request;
        return request;
    }

    private getUserRepositoryPaths(): string[] {
        return this.context.workspaceState.get<string[]>(RepositoryManager.USER_REPOSITORIES_KEY, []) || [];
    }

    private async saveUserRepositoryPaths(paths: string[]): Promise<void> {
        const normalized = Array.from(new Set(paths.map(normalizeExistingPath))).sort((a, b) => a.localeCompare(b));
        await this.context.workspaceState.update(RepositoryManager.USER_REPOSITORIES_KEY, normalized);
    }

    private getHiddenRepositoryPaths(): string[] {
        return this.context.workspaceState.get<string[]>(RepositoryManager.HIDDEN_REPOSITORIES_KEY, []) || [];
    }

    private async saveHiddenRepositoryPaths(paths: string[]): Promise<void> {
        const normalized = Array.from(new Set(paths.map(normalizeExistingPath))).sort((a, b) => a.localeCompare(b));
        await this.context.workspaceState.update(RepositoryManager.HIDDEN_REPOSITORIES_KEY, normalized);
    }

    private getSavedActiveRepositoryPath(): string | undefined {
        const savedRepoPath = this.context.workspaceState.get<string>(RepositoryManager.ACTIVE_REPOSITORY_KEY);
        return savedRepoPath ? normalizeExistingPath(savedRepoPath) : undefined;
    }

    private saveActiveRepositoryPath(repoPath: string | undefined): void {
        this.context.workspaceState.update(
            RepositoryManager.ACTIVE_REPOSITORY_KEY,
            repoPath ? normalizeExistingPath(repoPath) : undefined
        ).then(undefined, e => logger.error('Failed to save active repository', e));
    }

    private async scanRepositories() {
        const workspaceFolders = vscode.workspace.workspaceFolders || [];
        const newRepos = new Map<string, RepositoryScope>();
        let globalStateMigrationRepoPath: string | undefined;
        const hiddenRepoPaths = new Set(this.getHiddenRepositoryPaths());
        const candidateFolders: Array<{ folderPath: string; workspaceIndex?: number }> = [];

        for (const [index, folder] of workspaceFolders.entries()) {
            candidateFolders.push({
                folderPath: normalizeExistingPath(folder.uri.fsPath),
                workspaceIndex: index
            });
        }

        for (const repoPath of this.getUserRepositoryPaths()) {
            candidateFolders.push({
                folderPath: normalizeExistingPath(repoPath)
            });
        }

        const seenFolders = new Set<string>();
        for (const candidate of candidateFolders) {
            const folderPath = normalizeExistingPath(candidate.folderPath);
            if (seenFolders.has(folderPath)) {
                continue;
            }
            seenFolders.add(folderPath);

            if (!fs.existsSync(folderPath)) {
                continue;
            }

            try {
                const scope = await this.resolveRepositoryScope(folderPath);
                if (scope) {
                    if (hiddenRepoPaths.has(scope.repoPath)) {
                        continue;
                    }

                    newRepos.set(scope.repoPath, scope);
                    if (candidate.workspaceIndex === 0) {
                        globalStateMigrationRepoPath = scope.repoPath;
                    }

                    const git = simpleGit(scope.gitRoot);

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
                                    const absoluteSubPath = normalizeExistingPath(path.join(scope.gitRoot, subPath));
                                    const submoduleGit = simpleGit(absoluteSubPath);
                                    const submoduleGitState = await this.readRepositoryGitState(submoduleGit, absoluteSubPath);
                                    const submoduleScope = this.createRepositoryScope({
                                        workspaceRoot: absoluteSubPath,
                                        gitRoot: absoluteSubPath,
                                        isSubmodule: true,
                                        kind: 'submodule',
                                        ...submoduleGitState
                                    });
                                    if (!hiddenRepoPaths.has(submoduleScope.repoPath)) {
                                        newRepos.set(absoluteSubPath, submoduleScope);
                                    }
                                }
                            }
                        }
                    } catch (e) {
                        logger.error(`Failed to get submodules for ${scope.gitRoot}`, e);
                    }

                    const worktreeList = await this.readWorktreeList(git, scope.gitRoot);
                    for (const worktreeScope of await this.discoverLinkedWorktrees(git, scope.gitRoot, worktreeList)) {
                        if (!newRepos.has(worktreeScope.repoPath) && !hiddenRepoPaths.has(worktreeScope.repoPath)) {
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

        const activeChanged = this.reconcileActiveRepository();

        if (changed || activeChanged) {
            this._onDidChangeRepositories.fire();
        }
    }

    private reconcileActiveRepository(): boolean {
        const previousActiveRepoPath = this.activeRepoPath;
        const savedActiveRepoPath = this.getSavedActiveRepositoryPath();
        const requestedActiveRepoPath = previousActiveRepoPath || savedActiveRepoPath;
        const activeRepoStillAvailable = requestedActiveRepoPath && this.repositories.has(requestedActiveRepoPath);
        const nextRepoPath = activeRepoStillAvailable
            ? requestedActiveRepoPath
            : this.repositories.keys().next().value;
        const fallbackRepoPath = requestedActiveRepoPath && requestedActiveRepoPath !== nextRepoPath
            ? requestedActiveRepoPath
            : undefined;

        if (previousActiveRepoPath === nextRepoPath) {
            if (savedActiveRepoPath !== nextRepoPath) {
                this.saveActiveRepositoryPath(nextRepoPath);
            }
            if (fallbackRepoPath) {
                this._onDidFallbackActiveRepo.fire({
                    previousRepoPath: fallbackRepoPath,
                    nextRepoPath
                });
            }
            return Boolean(fallbackRepoPath);
        }

        this.activeRepoPath = nextRepoPath;
        this.saveActiveRepositoryPath(nextRepoPath);
        this._onDidChangeActiveRepo.fire(this.activeRepoPath);

        if (fallbackRepoPath) {
            this._onDidFallbackActiveRepo.fire({
                previousRepoPath: fallbackRepoPath,
                nextRepoPath
            });
        }

        return true;
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

    private async resolveRepositoryScope(folderPath: string): Promise<RepositoryScope | undefined> {
        const git = simpleGit(folderPath);
        if (!await git.checkIsRepo()) {
            return undefined;
        }

        const topLevel = await git.revparse(['--show-toplevel']);
        const rootPath = normalizeExistingPath(topLevel.trim());
        const rootGit = simpleGit(rootPath);
        const gitState = await this.readRepositoryGitState(rootGit, rootPath);
        const worktreeList = await this.readWorktreeList(rootGit, rootPath);
        const currentWorktreeRecord = worktreeList?.records.find(record => (
            record.path && normalizeExistingPath(record.path) === rootPath
        ));
        const isLinkedWorktreeRoot = Boolean(worktreeList && currentWorktreeRecord && rootPath !== worktreeList.mainWorktreePath);

        return this.createRepositoryScope({
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
        const normalizedRepoPath = normalizeExistingPath(repoPath);
        if (this.repositories.has(normalizedRepoPath) && this.activeRepoPath !== normalizedRepoPath) {
            this.activeRepoPath = normalizedRepoPath;
            this.saveActiveRepositoryPath(normalizedRepoPath);
            this._onDidChangeActiveRepo.fire(normalizedRepoPath);
            return true;
        }
        return false;
    }

    public async addRepository(folderPath: string): Promise<RepositoryScope | undefined> {
        const scope = await this.resolveRepositoryScope(normalizeExistingPath(folderPath));
        if (!scope) {
            return undefined;
        }

        const hidden = this.getHiddenRepositoryPaths().filter(path => path !== scope.repoPath);
        await this.saveHiddenRepositoryPaths(hidden);

        const userRepositories = this.getUserRepositoryPaths();
        if (!userRepositories.some(path => normalizeExistingPath(path) === scope.workspaceRoot)) {
            userRepositories.push(scope.workspaceRoot);
            await this.saveUserRepositoryPaths(userRepositories);
        }

        await this.scanRepositories();
        return this.repositories.get(scope.repoPath)?.info || scope;
    }

    public async removeRepository(repoPath: string): Promise<boolean> {
        const normalizedRepoPath = normalizeExistingPath(repoPath);
        const existing = this.repositories.get(normalizedRepoPath);
        const existed = Boolean(existing);
        const workspaceRoot = existing?.info.workspaceRoot;
        const userRepositories = this.getUserRepositoryPaths().filter(path => {
            const normalizedPath = normalizeExistingPath(path);
            return normalizedPath !== normalizedRepoPath && normalizedPath !== workspaceRoot;
        });
        await this.saveUserRepositoryPaths(userRepositories);

        const hidden = this.getHiddenRepositoryPaths();
        if (!hidden.some(path => normalizeExistingPath(path) === normalizedRepoPath)) {
            hidden.push(normalizedRepoPath);
            await this.saveHiddenRepositoryPaths(hidden);
        }

        await this.scanRepositories();
        return existed;
    }

    public async discoverWorkspaceRepositories(maxDepth = 3): Promise<RepositoryScope[]> {
        const workspaceFolders = vscode.workspace.workspaceFolders || [];
        const existing = new Set(this.getRepositories().map(repo => repo.repoPath));
        const hidden = new Set(this.getHiddenRepositoryPaths());
        const candidates = new Set<string>();
        const ignoredNames = new Set([
            '.git',
            '.hg',
            '.svn',
            'node_modules',
            'Pods',
            'build',
            'dist',
            'out',
            '.dart_tool',
            '.gradle',
            '.idea',
            '.vscode'
        ]);

        const walk = (dir: string, depth: number) => {
            if (depth > maxDepth) {
                return;
            }

            let entries: fs.Dirent[];
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch {
                return;
            }

            if (entries.some(entry => entry.name === '.git')) {
                candidates.add(dir);
                return;
            }

            for (const entry of entries) {
                if (!entry.isDirectory() || ignoredNames.has(entry.name)) {
                    continue;
                }
                walk(path.join(dir, entry.name), depth + 1);
            }
        };

        for (const folder of workspaceFolders) {
            walk(normalizeExistingPath(folder.uri.fsPath), 0);
        }

        const scopes: RepositoryScope[] = [];
        for (const candidate of candidates) {
            try {
                const scope = await this.resolveRepositoryScope(candidate);
                if (!scope || existing.has(scope.repoPath) || hidden.has(scope.repoPath)) {
                    continue;
                }
                scopes.push(scope);
            } catch (e) {
                logger.debug(`Ignoring unavailable repository candidate ${candidate}`, e);
            }
        }

        return scopes.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
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
        this._onDidChangeActiveRepo.dispose();
        this._onDidChangeRepositories.dispose();
        this._onDidFallbackActiveRepo.dispose();
    }
}
