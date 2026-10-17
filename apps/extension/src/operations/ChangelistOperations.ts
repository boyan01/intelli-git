import * as vscode from 'vscode';
import type { ChangelistInfo, ChangelistMode, ChangelistMoveRequest } from '@shared/messages';
import type { ChangelistStateService } from '../services/ChangelistStateService';
import type { ReviewedStateService } from '../services/ReviewedStateService';

export interface ChangelistOperationsOptions {
    changelistStateService: ChangelistStateService;
    reviewedStateService?: ReviewedStateService;
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
            await this.options.refreshDecorations?.();
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
        await this.options.refreshDecorations?.();
    }

    public async setActiveList(id: string): Promise<void> {
        await this.options.changelistStateService.setActiveList(id);
        this.options.refreshCommitView?.();
        await this.options.refreshDecorations?.();
    }

    public async setFilesReviewed(paths: string[], reviewed: boolean): Promise<void> {
        const uniquePaths = this.unique(paths);
        if (uniquePaths.length === 0 || !this.options.reviewedStateService) return;

        await this.options.reviewedStateService.setReviewed(uniquePaths, reviewed);
        this.options.refreshCommitView?.();
    }

    public async moveChangesToChangelist(request: ChangelistMoveRequest): Promise<void> {
        const paths = this.unique(request.paths || []);
        const hunksByPath = this.normalizeHunksByPath(request.hunksByPath);

        if (paths.length > 0) {
            await this.options.changelistStateService.moveFiles(paths, request.targetListId);
        }

        for (const [path, hunkIds] of Object.entries(hunksByPath)) {
            await this.options.changelistStateService.moveHunks(path, hunkIds, request.targetListId);
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
