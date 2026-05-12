import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import simpleGit from 'simple-git';
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
    isSubmodule: boolean;
}

interface RepositoryEntry {
    service: GitService;
    info: RepositoryScope;
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
                    const scope = this.createRepositoryScope({
                        workspaceRoot: folderPath,
                        gitRoot: rootPath,
                        isSubmodule: false
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
                                    newRepos.set(absoluteSubPath, this.createRepositoryScope({
                                        workspaceRoot: absoluteSubPath,
                                        gitRoot: absoluteSubPath,
                                        isSubmodule: true
                                    }));
                                }
                            }
                        }
                    } catch (e) {
                        logger.error(`Failed to get submodules for ${rootPath}`, e);
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

    private createRepositoryScope(input: { workspaceRoot: string; gitRoot: string; isSubmodule: boolean }): RepositoryScope {
        const repoPath = normalizeExistingPath(input.workspaceRoot);
        const gitRoot = normalizeExistingPath(input.gitRoot);
        return {
            name: path.basename(repoPath),
            repoPath,
            path: repoPath,
            workspaceRoot: repoPath,
            gitRoot,
            isSubmodule: input.isSubmodule
        };
    }

    private isSameScope(a: RepositoryScope, b: RepositoryScope): boolean {
        return a.name === b.name
            && a.repoPath === b.repoPath
            && a.path === b.path
            && a.workspaceRoot === b.workspaceRoot
            && a.gitRoot === b.gitRoot
            && a.isSubmodule === b.isSubmodule;
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
        // Sort: main repos first, then submodules, then alphabetically
        return repos.sort((a, b) => {
            if (a.isSubmodule !== b.isSubmodule) {
                return a.isSubmodule ? 1 : -1;
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
