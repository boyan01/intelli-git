import * as vscode from 'vscode';
import type {
    ChangelistAssignment,
    ChangelistInfo,
    ChangelistMode,
    ChangelistState,
    FileStatus,
} from '@shared/messages';
import { buildLogicalFiles, isConflictStatus, splitFileByChangelist } from '@shared/changelistRouting';
import { remapHunkValues } from '../utils/hunkIdentity';

interface PersistedChangelistState {
    /** Absent in states written before inactive changes became an ordinary changelist. */
    version?: number;
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

/** Inactive changes data written by releases before inactive changes became an ordinary changelist. */
interface LegacyInactiveData {
    files?: Record<string, { all?: boolean; hunkIds?: string[] }>;
}

export class ChangelistStateService {
    private static readonly STORAGE_KEY = 'ideaCommitPanel.changelists.v1';
    private static readonly MODE_STORAGE_KEY = 'ideaCommitPanel.changelistMode.v1';
    private static readonly LEGACY_INACTIVE_STORAGE_KEY = 'ideaCommitPanel.inactiveChangesV2';
    private static readonly DEFAULT_LIST_ID = 'changes';
    private static readonly LEGACY_INACTIVE_LIST_ID = 'inactive-changes';
    private static readonly STATE_VERSION = 2;
    private state: PersistedChangelistState = {
        lists: [{ id: ChangelistStateService.DEFAULT_LIST_ID, name: 'Changes' }],
        activeListId: ChangelistStateService.DEFAULT_LIST_ID,
        assignments: {},
    };

    private storageKey: string;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly repoPath?: string,
        private readonly migrateGlobalState = false
    ) {
        if (repoPath) {
            this.storageKey = `${ChangelistStateService.STORAGE_KEY}.${ChangelistStateService.hashRepoPath(repoPath)}`;
        } else {
            this.storageKey = ChangelistStateService.STORAGE_KEY;
        }
        this.loadState();
        this.ensureInvariants();
    }

    private static hashRepoPath(repoPath: string): string {
        return repoPath.replace(/[^a-zA-Z0-9]/g, '_');
    }

    private loadState() {
        let saved = this.context.workspaceState.get<PersistedChangelistState>(this.storageKey);

        // Migrate the old global key only for the repository that previously owned it.
        if (!saved && this.repoPath && this.migrateGlobalState) {
            const globalSaved = this.context.workspaceState.get<PersistedChangelistState>(
                ChangelistStateService.STORAGE_KEY
            );
            if (globalSaved) {
                saved = globalSaved;
            }
        }

        if (saved) {
            this.state = saved;
        }

        this.migrateLegacyInactiveChanges();
    }

    /**
     * Inactive changes used to live in a separate store and a reserved "Inactive Changes" list.
     * They are now an ordinary changelist: previously inactive files and change blocks move into
     * that list, and the reserved list is dropped when nothing was assigned to it.
     */
    private migrateLegacyInactiveChanges() {
        if (this.state.version === ChangelistStateService.STATE_VERSION) {
            return;
        }

        const legacyKey = this.repoPath
            ? `${ChangelistStateService.LEGACY_INACTIVE_STORAGE_KEY}.${ChangelistStateService.hashRepoPath(this.repoPath)}`
            : ChangelistStateService.LEGACY_INACTIVE_STORAGE_KEY;
        let legacy = this.context.workspaceState.get<LegacyInactiveData>(legacyKey);
        if (!legacy && this.repoPath && this.migrateGlobalState) {
            legacy = this.context.workspaceState.get<LegacyInactiveData>(
                ChangelistStateService.LEGACY_INACTIVE_STORAGE_KEY
            );
        }
        const listId = ChangelistStateService.LEGACY_INACTIVE_LIST_ID;
        this.state.assignments = this.state.assignments || {};
        for (const [path, info] of Object.entries(legacy?.files || {})) {
            if (info?.all) {
                this.state.assignments[path] = { fileListId: listId };
            } else if (info?.hunkIds && info.hunkIds.length > 0) {
                const assignment = this.state.assignments[path] || {};
                assignment.hunkListIds = assignment.hunkListIds || {};
                for (const hunkId of info.hunkIds) {
                    assignment.hunkListIds[hunkId] = listId;
                }
                this.state.assignments[path] = assignment;
            }
        }

        const isUsed =
            this.state.activeListId === listId ||
            Object.values(this.state.assignments).some(
                (assignment) =>
                    assignment?.fileListId === listId || Object.values(assignment?.hunkListIds || {}).includes(listId)
            );
        this.state.lists = (this.state.lists || []).filter((list) => list.id !== listId);
        if (isUsed) {
            this.state.lists.push({ id: listId, name: 'Inactive Changes' });
        }

        this.state.version = ChangelistStateService.STATE_VERSION;
        if (legacy) {
            void this.context.workspaceState.update(legacyKey, undefined);
        }
        void this.saveState();
    }

    private async saveState() {
        this.ensureInvariants();
        await this.context.workspaceState.update(this.storageKey, this.state);
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
        const seen = new Set<string>();
        this.state.lists = (this.state.lists || []).filter((list) => {
            if (!list.id || seen.has(list.id)) {
                return false;
            }
            seen.add(list.id);
            return true;
        });

        if (!this.hasList(ChangelistStateService.DEFAULT_LIST_ID)) {
            this.state.lists.unshift({ id: ChangelistStateService.DEFAULT_LIST_ID, name: 'Changes' });
        }

        if (!this.hasList(this.state.activeListId)) {
            this.state.activeListId = ChangelistStateService.DEFAULT_LIST_ID;
        }

        this.state.assignments = this.state.assignments || {};
        for (const [path, assignment] of Object.entries(this.state.assignments)) {
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
        return this.state.lists.some((list) => list.id === id);
    }

    private createInfo(): ChangelistInfo[] {
        return this.state.lists.map((list) => ({
            id: list.id,
            name: list.name,
            isDefault: list.id === ChangelistStateService.DEFAULT_LIST_ID,
            isActive: list.id === this.state.activeListId,
        }));
    }

    private getActiveMode(): ChangelistMode {
        return (
            this.context.workspaceState.get<ChangelistMode>(
                ChangelistStateService.MODE_STORAGE_KEY,
                vscode.workspace.getConfiguration('intelli-git').get<ChangelistMode>('changelist.mode', 'staged')
            ) || 'staged'
        );
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
            assignments: this.state.assignments,
        };
    }

    public async createList(name: string): Promise<ChangelistInfo> {
        const id = `changes-${Date.now()}`;
        this.state.lists.push({ id, name });
        await this.saveState();
        return this.createInfo().find((list) => list.id === id)!;
    }

    public async renameList(id: string, name: string): Promise<ChangelistInfo> {
        const target = this.state.lists.find((list) => list.id === id);
        if (!target || id === ChangelistStateService.DEFAULT_LIST_ID) {
            throw new Error(`Unknown changelist: ${id}`);
        }

        target.name = name;
        await this.saveState();
        return this.createInfo().find((list) => list.id === id)!;
    }

    public async deleteList(id: string): Promise<void> {
        if (id === ChangelistStateService.DEFAULT_LIST_ID || !this.hasList(id)) {
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

        this.state.lists = this.state.lists.filter((list) => list.id !== id);
        if (this.state.activeListId === id) {
            this.state.activeListId = fallbackId;
        }

        await this.saveState();
    }

    public async setActiveList(id: string): Promise<void> {
        if (!this.hasList(id)) {
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
            this.state.assignments[path] = { fileListId: targetListId };
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

    /**
     * Assigns every new change, including untracked files, to the active changelist and
     * carries existing change block assignments over when line positions shift.
     */
    public syncWithStatus(status: FileStatus[]) {
        const files = buildLogicalFiles(status);
        const paths = new Set(files.map((file) => file.path));
        let changed = false;

        // A rename keeps the changelist of its source path. Change blocks of a renamed file are one
        // whole-file block, so a source split across lists moves to a non-active list instead of
        // being committed with the active one.
        for (const file of files) {
            const originalPath = file.entries.find((entry) => entry.originalPath)?.originalPath;
            const source = originalPath ? this.state.assignments[originalPath] : undefined;
            if (!source || this.state.assignments[file.path]) {
                continue;
            }

            const listIds = new Set([
                ...(source.fileListId ? [source.fileListId] : []),
                ...Object.values(source.hunkListIds || {}),
            ]);
            const listId = Array.from(listIds).find((id) => id !== this.state.activeListId) || this.state.activeListId;
            this.state.assignments[file.path] = { fileListId: listId };
            changed = true;
        }

        for (const path of Object.keys(this.state.assignments)) {
            if (!paths.has(path)) {
                delete this.state.assignments[path];
                changed = true;
            }
        }

        for (const file of files) {
            if (isConflictStatus(file.status)) {
                continue;
            }

            const assignment = this.state.assignments[file.path] || {};

            if (file.hunks.length > 0) {
                const inheritedListId = assignment.fileListId;
                const activeListId = this.state.activeListId;
                const nextHunkIds = remapHunkValues(
                    file.hunks,
                    assignment.hunkListIds,
                    () => inheritedListId || activeListId,
                    // A block merged from blocks of different lists stays out of the active list
                    // rather than being committed by accident.
                    (current, merged) => (current === activeListId ? merged : current)
                );

                if (JSON.stringify(nextHunkIds) !== JSON.stringify(assignment.hunkListIds || {})) {
                    assignment.hunkListIds = nextHunkIds;
                    changed = true;
                }

                if (assignment.fileListId) {
                    delete assignment.fileListId;
                    changed = true;
                }
            } else {
                if (!assignment.fileListId) {
                    // A whole-file change keeps the list of the change blocks it had before.
                    const previousListIds = new Set(Object.values(assignment.hunkListIds || {}));
                    assignment.fileListId =
                        previousListIds.size === 1 ? Array.from(previousListIds)[0] : this.state.activeListId;
                    changed = true;
                }

                if (assignment.hunkListIds) {
                    delete assignment.hunkListIds;
                    changed = true;
                }
            }

            this.state.assignments[file.path] = assignment;
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

            if (assignment.hunkListIds && Object.values(assignment.hunkListIds).some((listId) => listId === id)) {
                count += 1;
            }
        }

        return count;
    }

    public buildCommitPlan(
        status: FileStatus[],
        requestedFiles?: Iterable<string>,
        targetListId = this.state.activeListId
    ): CommitPlan {
        const requestedFileValues = requestedFiles ? Array.from(requestedFiles) : [];
        const requestedFileSet = requestedFileValues.length > 0 ? new Set(requestedFileValues) : undefined;

        const files: string[] = [];
        const excludedFiles: string[] = [];
        const excludedHunkIdsByPath: Record<string, string[]> = {};

        for (const file of buildLogicalFiles(status)) {
            if (requestedFileSet && !requestedFileSet.has(file.path)) {
                continue;
            }

            if (isConflictStatus(file.status)) {
                excludedFiles.push(file.path);
                continue;
            }

            const slices = splitFileByChangelist(
                file.hunks,
                this.state.assignments[file.path],
                this.state.activeListId
            );
            const target = slices.find((slice) => slice.listId === targetListId);
            if (!target) {
                excludedFiles.push(file.path);
                continue;
            }

            files.push(file.path);
            const excludedHunkIds = slices
                .filter((slice) => slice !== target)
                .flatMap((slice) => slice.hunks || [])
                .map((hunk) => hunk.id);
            if (excludedHunkIds.length > 0) {
                excludedHunkIdsByPath[file.path] = excludedHunkIds;
            }
        }

        return { files, excludedFiles, excludedHunkIdsByPath };
    }
}
