import * as vscode from 'vscode';
import * as path from 'path';
import simpleGit from 'simple-git';
import { GitService } from './GitService';
import { InactiveChangesService } from './InactiveChangesService';
import { ChangelistStateService } from './ChangelistStateService';
import { logger } from '../utils/logger';

export interface RepositoryInfo {
    name: string;
    path: string;
    isSubmodule: boolean;
}

interface RepositoryEntry {
    service: GitService;
    info: RepositoryInfo;
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
        const newRepos = new Map<string, { isSubmodule: boolean }>();
        let globalStateMigrationRepoPath: string | undefined;

        for (const [index, folder] of workspaceFolders.entries()) {
            const folderPath = folder.uri.fsPath;
            try {
                const git = simpleGit(folderPath);
                const isRepo = await git.checkIsRepo();
                if (isRepo) {
                    const topLevel = await git.revparse(['--show-toplevel']);
                    const rootPath = path.normalize(topLevel.trim());
                    newRepos.set(rootPath, { isSubmodule: false });
                    if (index === 0) {
                        globalStateMigrationRepoPath = rootPath;
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
                                    const absoluteSubPath = path.normalize(path.join(rootPath, subPath));
                                    newRepos.set(absoluteSubPath, { isSubmodule: true });
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
        for (const [repoPath, repoMetadata] of newRepos.entries()) {
            const info: RepositoryInfo = {
                name: path.basename(repoPath),
                path: repoPath,
                isSubmodule: repoMetadata.isSubmodule
            };

            const existing = this.repositories.get(repoPath);
            if (existing) {
                if (existing.info.isSubmodule !== info.isSubmodule || existing.info.name !== info.name) {
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
                    const gitService = await GitService.create(repoPath, inactiveService, changelistService);
                    this.repositories.set(repoPath, { service: gitService, info });
                    changed = true;
                } catch (e) {
                    logger.error(`Failed to create GitService for ${repoPath}`, e);
                }
            }
        }

        if (changed) {
            if (!this.activeRepoPath || !this.repositories.has(this.activeRepoPath)) {
                // Set first as active
                this.activeRepoPath = this.repositories.keys().next().value;
                this._onDidChangeActiveRepo.fire(this.activeRepoPath);
            }
            this._onDidChangeRepositories.fire();
        }
    }

    public getActiveService(): GitService | undefined {
        if (this.activeRepoPath) {
            return this.repositories.get(this.activeRepoPath)?.service;
        }
        return undefined;
    }

    public getActiveRepoPath(): string | undefined {
        return this.activeRepoPath;
    }

    public getRepositories(): RepositoryInfo[] {
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
