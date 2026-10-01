import * as vscode from 'vscode';
import type { ChangelistInfo, ChangelistMode, ChangelistMoveRequest } from '@shared/messages';
import type { GitService } from '../services/GitService';
import type { ChangelistStateService } from '../services/ChangelistStateService';
import type { InactiveChangesService } from '../services/InactiveChangesService';

export interface ChangelistOperationsOptions {
    gitService: GitService;
    inactiveChangesService: InactiveChangesService;
    changelistStateService: ChangelistStateService;
    refreshCommitView?: () => void;
    refreshDecorations?: () => Promise<void>;
    setModeContext?: (mode: ChangelistMode) => Promise<void>;
}

export class ChangelistOperations {
    constructor(private readonly options: ChangelistOperationsOptions) {}

    public async setMode(mode: ChangelistMode): Promise<void> {
        if (this.options.changelistStateService.getState().mode !== mode) {
            await this.options.changelistStateService.setMode(mode);
            this.options.refreshCommitView?.();
        }
        await this.options.setModeContext?.(mode);
    }

    public async createList(name: string): Promise<ChangelistInfo> {
        const list = await this.options.changelistStateService.createList(name);
        this.options.refreshCommitView?.();
        return list;
    }

    public async renameList(id: string, name: string): Promise<ChangelistInfo> {
        const list = await this.options.changelistStateService.renameList(id, name);
        this.options.refreshCommitView?.();
        return list;
    }

    public async deleteList(id: string): Promise<void> {
        await this.options.changelistStateService.deleteList(id);
        this.options.refreshCommitView?.();
    }

    public async setActiveList(id: string): Promise<void> {
        await this.options.changelistStateService.setActiveList(id);
        this.options.refreshCommitView?.();
    }

    public async markFilesInactive(paths: string[]): Promise<void> {
        const uniquePaths = this.unique(paths);
        if (uniquePaths.length === 0) return;

        await this.options.inactiveChangesService.markInactive(uniquePaths);

        const status = await this.options.gitService.getStatus();
        const stagedPaths = Array.from(
            new Set(status.filter((file) => uniquePaths.includes(file.path) && file.staged).map((file) => file.path))
        );

        if (stagedPaths.length > 0) {
            await this.options.gitService.unstageFiles(stagedPaths);
        }

        this.options.refreshCommitView?.();
    }

    public async markFilesActive(paths: string[]): Promise<void> {
        const uniquePaths = this.unique(paths);
        if (uniquePaths.length === 0) return;

        await this.options.inactiveChangesService.markActive(uniquePaths);
        this.options.refreshCommitView?.();
    }

    public async markHunksInactive(path: string, hunkIds: string[]): Promise<void> {
        for (const hunkId of this.unique(hunkIds)) {
            await this.options.inactiveChangesService.markHunkInactive(path, hunkId);
        }
        this.options.refreshCommitView?.();
        await this.options.refreshDecorations?.();
    }

    public async markHunksActive(path: string, hunkIds: string[]): Promise<void> {
        for (const hunkId of this.unique(hunkIds)) {
            await this.options.inactiveChangesService.markHunkActive(path, hunkId);
        }
        this.options.refreshCommitView?.();
        await this.options.refreshDecorations?.();
    }

    public async moveChangesToChangelist(request: ChangelistMoveRequest): Promise<void> {
        const paths = this.unique(request.paths || []);
        const hunksByPath = this.normalizeHunksByPath(request.hunksByPath);

        if (request.activateInactive) {
            if (paths.length > 0) {
                await this.options.inactiveChangesService.markActive(paths);
            }

            for (const [path, hunkIds] of Object.entries(hunksByPath)) {
                for (const hunkId of hunkIds) {
                    await this.options.inactiveChangesService.markHunkActive(path, hunkId);
                }
            }
        }

        if (paths.length > 0) {
            await this.options.changelistStateService.moveFiles(paths, request.targetListId);
        }

        for (const [path, hunkIds] of Object.entries(hunksByPath)) {
            if (hunkIds.length > 0) {
                await this.options.changelistStateService.moveHunks(path, hunkIds, request.targetListId);
            }
        }

        this.options.refreshCommitView?.();
        await this.options.refreshDecorations?.();
    }

    private unique(values: string[]): string[] {
        return Array.from(new Set(values.filter(Boolean)));
    }

    private normalizeHunksByPath(hunksByPath: Record<string, string[]> | undefined): Record<string, string[]> {
        const result: Record<string, string[]> = {};
        for (const [path, hunkIds] of Object.entries(hunksByPath || {})) {
            const ids = this.unique(hunkIds);
            if (path && ids.length > 0) {
                result[path] = ids;
            }
        }
        return result;
    }
}

export function createDefaultRefreshDecorations(): () => Promise<void> {
    return async () => {
        await vscode.commands.executeCommand('intelli-git.refreshChangeBlockDecorations');
    };
}
