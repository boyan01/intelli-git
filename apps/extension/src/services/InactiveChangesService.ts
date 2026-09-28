import * as vscode from 'vscode';
import type { FileStatus } from '@shared/messages';
import { remapHunkIdSet } from '../utils/hunkIdentity';

interface InactiveData {
    // filePath -> set of hunkIds
    files: { [path: string]: { all?: boolean; hunkIds?: string[] } };
}

export type InactiveChangesSnapshot = InactiveData;

function normalizeInactivePath(filePath: string): string {
    return filePath.replace(/\\/g, '/').replace(/\/+$/, '');
}

function isSameOrDescendantPath(filePath: string, inactivePath: string): boolean {
    const normalizedFilePath = normalizeInactivePath(filePath);
    const normalizedInactivePath = normalizeInactivePath(inactivePath);
    return normalizedFilePath === normalizedInactivePath ||
        normalizedFilePath.startsWith(`${normalizedInactivePath}/`);
}

export class InactiveChangesService {
    private static readonly STORAGE_KEY_V2 = 'ideaCommitPanel.inactiveChangesV2';
    private state: InactiveData = { files: {} };

    private storageKey: string;

    constructor(
        private context: vscode.ExtensionContext,
        private repoPath?: string,
        private migrateGlobalState = false
    ) {
        if (repoPath) {
            const hash = repoPath.replace(/[^a-zA-Z0-9]/g, '_');
            this.storageKey = `${InactiveChangesService.STORAGE_KEY_V2}.${hash}`;
        } else {
            this.storageKey = InactiveChangesService.STORAGE_KEY_V2;
        }
        this.loadState();
    }

    private loadState() {
        // Migration from V1 (if exists) or load V2
        const v1Saved = this.context.workspaceState.get<string[]>('ideaCommitPanel.inactiveChanges');
        let v2Saved = this.context.workspaceState.get<InactiveData>(this.storageKey);

        // Migrate the old global key only for the repository that previously owned it.
        if (!v2Saved && this.repoPath && this.migrateGlobalState) {
             const globalV2Saved = this.context.workspaceState.get<InactiveData>(InactiveChangesService.STORAGE_KEY_V2);
             if (globalV2Saved) {
                 v2Saved = globalV2Saved;
             }
        }

        if (v2Saved) {
            this.state = v2Saved;
        } else if (v1Saved && v1Saved.length > 0) {
            // Migrate V1
            v1Saved.forEach(path => {
                this.state.files[path] = { all: true };
            });
            void this.saveState();
        }
    }

    private async saveState() {
        await this.context.workspaceState.update(
            this.storageKey,
            this.state
        );
    }

    public createSnapshot(): InactiveChangesSnapshot {
        return JSON.parse(JSON.stringify(this.state)) as InactiveChangesSnapshot;
    }

    public async restoreSnapshot(snapshot: InactiveChangesSnapshot): Promise<void> {
        this.state = JSON.parse(JSON.stringify(snapshot)) as InactiveData;
        await this.saveState();
    }

    public getInactiveFiles(): string[] {
        return Object.keys(this.state.files).filter(path => this.state.files[path].all);
    }

    public getInactiveHunkIds(filePath: string): string[] {
        return this.state.files[filePath]?.hunkIds || [];
    }

    public isInactive(filePath: string): boolean {
        return Object.entries(this.state.files).some(([inactivePath, info]) =>
            Boolean(info.all && isSameOrDescendantPath(filePath, inactivePath))
        );
    }

    public async markInactive(files: string[]): Promise<void> {
        files.forEach(file => {
            this.state.files[file] = { all: true };
        });
        await this.saveState();
    }

    public async markActive(files: string[]): Promise<void> {
        files.forEach(file => {
            delete this.state.files[file];
        });
        await this.saveState();
    }

    public async markHunkInactive(path: string, hunkId: string): Promise<void> {
        if (!this.state.files[path]) {
            this.state.files[path] = { hunkIds: [] };
        }
        const fileInfo = this.state.files[path];
        if (!fileInfo.all) {
            const hunkIds = new Set(fileInfo.hunkIds || []);
            hunkIds.add(hunkId);
            fileInfo.hunkIds = Array.from(hunkIds);
        }
        await this.saveState();
    }

    public async markHunkActive(path: string, hunkId: string): Promise<void> {
        const fileInfo = this.state.files[path];
        if (fileInfo && fileInfo.hunkIds) {
            const equivalentIds = new Set([
                hunkId,
                hunkId.replace(':index:', ':worktree:'),
                hunkId.replace(':worktree:', ':index:')
            ]);
            fileInfo.hunkIds = fileInfo.hunkIds.filter(id => !equivalentIds.has(id));
            if (fileInfo.hunkIds.length === 0 && !fileInfo.all) {
                delete this.state.files[path];
            }
        }
        await this.saveState();
    }

    public async markMatchingHunkActive(path: string, hunkId: string, currentHunks: FileStatus['hunks'] = []): Promise<void> {
        const fileInfo = this.state.files[path];
        if (!fileInfo) {
            return;
        }

        if (fileInfo.all) {
            const equivalentIds = new Set([
                hunkId,
                hunkId.replace(':index:', ':worktree:'),
                hunkId.replace(':worktree:', ':index:')
            ]);
            const remainingInactiveHunkIds = (currentHunks || [])
                .filter(hunk => !equivalentIds.has(hunk.id))
                .map(hunk => hunk.id);

            if (remainingInactiveHunkIds.length === 0) {
                delete this.state.files[path];
            } else {
                this.state.files[path] = { hunkIds: remainingInactiveHunkIds };
            }

            await this.saveState();
            return;
        }

        if (!fileInfo.hunkIds) {
            return;
        }

        const hunkIds = new Set([hunkId]);
        for (const storedId of fileInfo.hunkIds) {
            if (remapHunkIdSet(currentHunks || [], [storedId]).includes(hunkId)) {
                hunkIds.add(storedId);
            }
        }

        fileInfo.hunkIds = fileInfo.hunkIds.filter(id => !hunkIds.has(id));
        if (fileInfo.hunkIds.length === 0) {
            delete this.state.files[path];
        }

        await this.saveState();
    }

    public syncWithStatus(status: FileStatus[]) {
        const grouped = new Map<string, FileStatus[]>();
        for (const file of status) {
            const entries = grouped.get(file.path) || [];
            entries.push(file);
            grouped.set(file.path, entries);
        }

        const validPaths = new Set(grouped.keys());
        let changed = false;

        Object.keys(this.state.files).forEach(path => {
            if (validPaths.has(path)) {
                return;
            }

            const fileInfo = this.state.files[path];
            const descendantPaths = fileInfo.all
                ? Array.from(validPaths).filter(validPath => isSameOrDescendantPath(validPath, path))
                : [];
            if (descendantPaths.length > 0) {
                descendantPaths.forEach(descendantPath => {
                    this.state.files[descendantPath] = { all: true };
                });
            }

            delete this.state.files[path];
            changed = true;
        });

        for (const [path, fileInfo] of Object.entries(this.state.files)) {
            if (fileInfo.all || !fileInfo.hunkIds || fileInfo.hunkIds.length === 0) {
                continue;
            }

            const entries = grouped.get(path) || [];
            // Untracked files have always had one whole-file hunk. Preserve legacy
            // assignments when status no longer eagerly includes that hunk.
            if (entries.some(entry => entry.status === '?')) {
                this.state.files[path] = { all: true };
                entries.forEach(entry => { entry.inactive = true; });
                changed = true;
                continue;
            }
            const hunks = Array.from(new Map(
                entries.flatMap(entry => (entry.hunks || []).map(hunk => [hunk.id, hunk]))
            ).values());
            const nextHunkIds = remapHunkIdSet(hunks, fileInfo.hunkIds);

            if (JSON.stringify(nextHunkIds) !== JSON.stringify(fileInfo.hunkIds)) {
                fileInfo.hunkIds = nextHunkIds;
                changed = true;
            }

            if (fileInfo.hunkIds.length === 0) {
                delete this.state.files[path];
                changed = true;
            }
        }

        if (changed) {
            void this.saveState();
        }
    }
}
