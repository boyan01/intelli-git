import * as vscode from 'vscode';
import type { ChangelistAssignment, ChangelistInfo, ChangelistMode, ChangelistState, FileStatus } from '@shared/messages';
import { remapHunkValues } from '../utils/hunkIdentity';

interface PersistedChangelistState {
    lists: Array<{ id: string; name: string }>;
    activeListId: string;
    assignments: Record<string, ChangelistAssignment>;
}

export type ChangelistStateSnapshot = PersistedChangelistState;

export interface CommitPlan {
    files: string[];
    excludedFiles: string[];
    excludedHunkIdsByPath: Record<string, string[]>;
}

export class ChangelistStateService {
    private static readonly STORAGE_KEY = 'ideaCommitPanel.changelists.v1';
    private static readonly MODE_STORAGE_KEY = 'ideaCommitPanel.changelistMode.v1';
    private static readonly DEFAULT_LIST_ID = 'changes';
    private static readonly INACTIVE_LIST_ID = 'inactive-changes';
    private state: PersistedChangelistState = {
        lists: [
            { id: ChangelistStateService.DEFAULT_LIST_ID, name: 'Changes' },
            { id: ChangelistStateService.INACTIVE_LIST_ID, name: 'Inactive Changes' }
        ],
        activeListId: ChangelistStateService.DEFAULT_LIST_ID,
        assignments: {}
    };

    constructor(private readonly context: vscode.ExtensionContext) {
        this.loadState();
        this.ensureInvariants();
    }

    private loadState() {
        const saved = this.context.workspaceState.get<PersistedChangelistState>(ChangelistStateService.STORAGE_KEY);
        if (saved) {
            this.state = saved;
        }
    }

    private async saveState() {
        this.ensureInvariants();
        await this.context.workspaceState.update(ChangelistStateService.STORAGE_KEY, this.state);
    }

    public createSnapshot(): ChangelistStateSnapshot {
        this.ensureInvariants();
        return JSON.parse(JSON.stringify(this.state)) as ChangelistStateSnapshot;
    }

    public async restoreSnapshot(snapshot: ChangelistStateSnapshot): Promise<void> {
        this.state = JSON.parse(JSON.stringify(snapshot)) as PersistedChangelistState;
        await this.saveState();
    }

    private ensureInvariants() {
        if (!this.state.lists || this.state.lists.length === 0) {
            this.state.lists = [];
        }

        const ensureList = (id: string, name: string) => {
            if (!this.state.lists.some(list => list.id === id)) {
                this.state.lists.push({ id, name });
            }
        };

        ensureList(ChangelistStateService.DEFAULT_LIST_ID, 'Changes');
        ensureList(ChangelistStateService.INACTIVE_LIST_ID, 'Inactive Changes');

        const seen = new Set<string>();
        this.state.lists = this.state.lists.filter(list => {
            if (!list.id || seen.has(list.id)) {
                return false;
            }
            seen.add(list.id);
            return true;
        });

        if (!this.state.lists.some(list => list.id === this.state.activeListId)) {
            this.state.activeListId = this.state.lists.find(list => list.id !== ChangelistStateService.INACTIVE_LIST_ID)?.id || ChangelistStateService.DEFAULT_LIST_ID;
        }

        if (this.state.activeListId === ChangelistStateService.INACTIVE_LIST_ID) {
            this.state.activeListId = ChangelistStateService.DEFAULT_LIST_ID;
        }

        for (const [path, assignment] of Object.entries(this.state.assignments || {})) {
            if (!assignment) {
                delete this.state.assignments[path];
                continue;
            }

            if (assignment.fileListId && !this.hasList(assignment.fileListId)) {
                delete assignment.fileListId;
            }

            if (assignment.hunkListIds) {
                for (const [hunkId, listId] of Object.entries(assignment.hunkListIds)) {
                    if (!this.hasList(listId)) {
                        delete assignment.hunkListIds[hunkId];
                    }
                }

                if (Object.keys(assignment.hunkListIds).length === 0) {
                    delete assignment.hunkListIds;
                }
            }

            if (!assignment.fileListId && !assignment.hunkListIds) {
                delete this.state.assignments[path];
            }
        }
    }

    private hasList(id: string): boolean {
        return this.state.lists.some(list => list.id === id);
    }

    private createInfo(): ChangelistInfo[] {
        return this.state.lists.map(list => ({
            id: list.id,
            name: list.name,
            isDefault: list.id === ChangelistStateService.DEFAULT_LIST_ID || list.id === ChangelistStateService.INACTIVE_LIST_ID,
            isActive: list.id === this.state.activeListId
        }));
    }

    private getActiveMode(): ChangelistMode {
        return this.context.workspaceState.get<ChangelistMode>(
            ChangelistStateService.MODE_STORAGE_KEY,
            vscode.workspace.getConfiguration('intelli-git').get<ChangelistMode>('changelist.mode', 'staged')
        ) || 'staged';
    }

    public async setMode(mode: ChangelistMode): Promise<void> {
        await this.context.workspaceState.update(ChangelistStateService.MODE_STORAGE_KEY, mode);
    }

    public getState(): ChangelistState {
        this.ensureInvariants();
        return {
            mode: this.getActiveMode(),
            activeListId: this.state.activeListId,
            lists: this.createInfo(),
            assignments: this.state.assignments
        };
    }

    public async createList(name: string): Promise<ChangelistInfo> {
        const id = `changes-${Date.now()}`;
        this.state.lists.push({ id, name });
        await this.saveState();
        return this.createInfo().find(list => list.id === id)!;
    }

    public async renameList(id: string, name: string): Promise<ChangelistInfo> {
        const target = this.state.lists.find(list => list.id === id);
        if (!target || id === ChangelistStateService.DEFAULT_LIST_ID || id === ChangelistStateService.INACTIVE_LIST_ID) {
            throw new Error(`Unknown changelist: ${id}`);
        }

        target.name = name;
        await this.saveState();
        return this.createInfo().find(list => list.id === id)!;
    }

    public async deleteList(id: string): Promise<void> {
        if (id === ChangelistStateService.DEFAULT_LIST_ID || id === ChangelistStateService.INACTIVE_LIST_ID) {
            return;
        }

        if (this.state.lists.length <= 2) {
            return;
        }

        const target = this.state.lists.find(list => list.id === id);
        if (!target) {
            return;
        }

        const fallbackId = ChangelistStateService.DEFAULT_LIST_ID;

        for (const assignment of Object.values(this.state.assignments)) {
            if (assignment.fileListId === id) {
                assignment.fileListId = fallbackId;
            }

            if (assignment.hunkListIds) {
                for (const hunkId of Object.keys(assignment.hunkListIds)) {
                    if (assignment.hunkListIds[hunkId] === id) {
                        assignment.hunkListIds[hunkId] = fallbackId;
                    }
                }
            }
        }

        this.state.lists = this.state.lists.filter(list => list.id !== id);
        if (this.state.activeListId === id) {
            this.state.activeListId = fallbackId;
        }

        await this.saveState();
    }

    public async setActiveList(id: string): Promise<void> {
        if (!this.hasList(id) || id === ChangelistStateService.INACTIVE_LIST_ID) {
            return;
        }
        this.state.activeListId = id;
        await this.saveState();
    }

    public async moveFiles(paths: string[], targetListId: string): Promise<void> {
        if (!this.hasList(targetListId)) {
            return;
        }

        for (const path of paths) {
            const assignment = this.state.assignments[path] || {};
            assignment.fileListId = targetListId;
            delete assignment.hunkListIds;
            this.state.assignments[path] = assignment;
        }

        await this.saveState();
    }

    public async moveHunks(path: string, hunkIds: string[], targetListId: string): Promise<void> {
        if (!this.hasList(targetListId) || hunkIds.length === 0) {
            return;
        }

        const assignment = this.state.assignments[path] || {};
        assignment.hunkListIds = assignment.hunkListIds || {};

        for (const hunkId of hunkIds) {
            assignment.hunkListIds[hunkId] = targetListId;
        }

        delete assignment.fileListId;
        this.state.assignments[path] = assignment;
        await this.saveState();
    }

    public syncWithStatus(status: FileStatus[]) {
        const grouped = new Map<string, FileStatus[]>();
        for (const file of status) {
            const list = grouped.get(file.path) || [];
            list.push(file);
            grouped.set(file.path, list);
        }

        let changed = false;

        for (const path of Object.keys(this.state.assignments)) {
            if (!grouped.has(path)) {
                delete this.state.assignments[path];
                changed = true;
            }
        }

        for (const [path, entries] of grouped.entries()) {
            if (entries.some(entry => entry.status === '?')) {
                continue;
            }

            const hunks = Array.from(new Map(
                entries.flatMap(entry => (entry.hunks || []).map(hunk => [hunk.id, hunk]))
            ).values());
            const assignment = this.state.assignments[path] || {};

            if (hunks.length > 0) {
                const nextHunkIds = remapHunkValues(hunks, assignment.hunkListIds, () => this.state.activeListId);

                if (JSON.stringify(nextHunkIds) !== JSON.stringify(assignment.hunkListIds || {})) {
                    assignment.hunkListIds = nextHunkIds;
                    changed = true;
                }

                if (assignment.fileListId) {
                    delete assignment.fileListId;
                    changed = true;
                }
            } else if (!assignment.fileListId) {
                assignment.fileListId = this.state.activeListId;
                changed = true;
            }

            if (assignment.hunkListIds && hunks.length === 0) {
                delete assignment.hunkListIds;
                changed = true;
            }

            this.state.assignments[path] = assignment;
        }

        this.ensureInvariants();

        if (changed) {
            void this.saveState();
        }
    }

    public getListItemCount(id: string): number {
        let count = 0;

        for (const assignment of Object.values(this.state.assignments)) {
            if (assignment.fileListId === id) {
                count += 1;
                continue;
            }

            if (assignment.hunkListIds && Object.values(assignment.hunkListIds).some(listId => listId === id)) {
                count += 1;
            }
        }

        return count;
    }

    public buildCommitPlan(status: FileStatus[]): CommitPlan {
        const grouped = new Map<string, FileStatus[]>();
        for (const file of status) {
            const list = grouped.get(file.path) || [];
            list.push(file);
            grouped.set(file.path, list);
        }

        const files = new Set<string>();
        const excludedFiles = new Set<string>();
        const excludedHunkIdsByPath: Record<string, string[]> = {};

        for (const [path, entries] of grouped.entries()) {
            if (entries.some(entry => entry.status === '?')) {
                continue;
            }

            const assignment = this.state.assignments[path];
            const hunks = Array.from(new Map(
                entries.flatMap(entry => (entry.hunks || []).map(hunk => [hunk.id, hunk]))
            ).values());
            const inactiveHunkIds = new Set(entries.flatMap(entry => entry.inactiveHunkIds || []));
            const isInactiveFile = entries.some(entry => entry.inactive);

            if (isInactiveFile) {
                excludedFiles.add(path);
                continue;
            }

            if (hunks.length > 0) {
                const excludedHunks = hunks
                    .filter(hunk => inactiveHunkIds.has(hunk.id) || (assignment?.hunkListIds?.[hunk.id] || this.state.activeListId) !== this.state.activeListId)
                    .map(hunk => hunk.id);

                if (excludedHunks.length < hunks.length) {
                    files.add(path);
                } else {
                    excludedFiles.add(path);
                }

                if (excludedHunks.length > 0) {
                    excludedHunkIdsByPath[path] = excludedHunks;
                }

                continue;
            }

            if ((assignment?.fileListId || this.state.activeListId) === this.state.activeListId) {
                files.add(path);
            } else {
                excludedFiles.add(path);
            }
        }

        return {
            files: Array.from(files),
            excludedFiles: Array.from(excludedFiles),
            excludedHunkIdsByPath
        };
    }
}
