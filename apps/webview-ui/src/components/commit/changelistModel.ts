import type { ChangelistAssignment, ChangelistGroup, ChangelistState, FileStatus, GitHunk } from '@shared/messages';

export const INACTIVE_CHANGELIST_ID = 'inactive-changes';

type Translate = (key: string) => string;

type LogicalFile = {
    path: string;
    status: FileStatus['status'];
    entries: FileStatus[];
    hunks: GitHunk[];
    inactive: boolean;
    inactiveHunkIds: string[];
    resolvedCandidate?: boolean;
    error?: boolean;
    hasStagedInactive?: boolean;
};

export interface SplitFileInfo {
    groupCount: number;
    groupNames: string[];
}

export function getEquivalentHunkIds(hunkId: string): string[] {
    return [
        hunkId,
        hunkId.replace(':index:', ':worktree:'),
        hunkId.replace(':worktree:', ':index:')
    ];
}

export function isInactiveHunkId(hunkId: string, inactiveHunkIds?: string[]): boolean {
    if (!inactiveHunkIds || inactiveHunkIds.length === 0) {
        return false;
    }

    const inactiveSet = new Set(inactiveHunkIds);
    return getEquivalentHunkIds(hunkId).some(id => inactiveSet.has(id));
}

export function hasOnlyInactiveHunks(file: { inactive?: boolean; hunks?: GitHunk[]; inactiveHunkIds?: string[] }): boolean {
    if (file.inactive) {
        return true;
    }

    if (!file.hunks || file.hunks.length === 0 || !file.inactiveHunkIds || file.inactiveHunkIds.length === 0) {
        return false;
    }

    return file.hunks.every(hunk => isInactiveHunkId(hunk.id, file.inactiveHunkIds));
}

function getAssignedHunkListId(hunkId: string, assignment?: ChangelistAssignment): string | undefined {
    return getEquivalentHunkIds(hunkId)
        .map(id => assignment?.hunkListIds?.[id])
        .find((id): id is string => Boolean(id));
}

function getInactiveHunks(file: { hunks?: GitHunk[]; inactiveHunkIds?: string[] }): GitHunk[] {
    if (!file.hunks || !file.inactiveHunkIds || file.inactiveHunkIds.length === 0) {
        return [];
    }

    return file.hunks.filter(hunk => isInactiveHunkId(hunk.id, file.inactiveHunkIds));
}

function getActiveHunks(file: { hunks?: GitHunk[]; inactiveHunkIds?: string[] }): GitHunk[] {
    if (!file.hunks || file.hunks.length === 0) {
        return [];
    }

    return file.hunks.filter(hunk => !isInactiveHunkId(hunk.id, file.inactiveHunkIds));
}

function getLogicalStatus(entries: FileStatus[]): FileStatus['status'] {
    if (entries.some(entry => entry.status === 'C' || entry.status === 'U')) {
        return 'C';
    }
    if (entries.some(entry => entry.status === '?')) {
        return '?';
    }
    if (entries.some(entry => entry.status === 'D')) {
        return 'D';
    }
    if (entries.some(entry => entry.status === 'A')) {
        return 'A';
    }
    return entries[0]?.status || 'M';
}

function buildLogicalFiles(files: FileStatus[]): LogicalFile[] {
    const grouped = new Map<string, FileStatus[]>();
    files.forEach(file => {
        const entries = grouped.get(file.path) || [];
        entries.push(file);
        grouped.set(file.path, entries);
    });

    return Array.from(grouped.entries()).map(([path, entries]) => {
        const hunks = Array.from(new Map(
            entries.flatMap(entry => (entry.hunks || []).map(hunk => [hunk.id, hunk]))
        ).values());
        const inactiveHunkIds = Array.from(new Set(entries.flatMap(entry => entry.inactiveHunkIds || [])));

        return {
            path,
            status: getLogicalStatus(entries),
            entries,
            hunks,
            inactive: entries.some(entry => entry.inactive),
            inactiveHunkIds,
            resolvedCandidate: entries.some(entry => entry.resolvedCandidate),
            error: entries.some(entry => entry.error),
            hasStagedInactive: entries.some(entry => entry.hasStagedInactive)
        };
    });
}

function toDisplayFile(file: LogicalFile, hunks?: GitHunk[], inactive = file.inactive): FileStatus {
    return {
        path: file.path,
        status: file.status,
        staged: false,
        inactive,
        hunks,
        inactiveHunkIds: file.inactiveHunkIds,
        resolvedCandidate: file.resolvedCandidate,
        error: file.error,
        hasStagedInactive: file.hasStagedInactive
    };
}

function toActiveFileStatus(file: FileStatus): FileStatus | undefined {
    if (file.inactive || hasOnlyInactiveHunks(file)) {
        return undefined;
    }

    const activeHunks = getActiveHunks(file);
    if (file.hunks && file.hunks.length > 0) {
        if (activeHunks.length === 0) {
            return undefined;
        }

        return {
            ...file,
            hunks: activeHunks,
            inactive: false
        };
    }

    return file;
}

export function buildChangelists(files: FileStatus[], changelistState: ChangelistState, t: Translate): ChangelistGroup[] {
    const logicalFiles = buildLogicalFiles(files);
    const changelistGroups = new Map<string, FileStatus[]>();
    changelistState.lists.forEach(list => changelistGroups.set(list.id, []));

    const inactiveFiles: FileStatus[] = [];
    const untrackedFiles: FileStatus[] = [];

    logicalFiles.forEach(file => {
        if (file.inactive) {
            if (changelistState.mode === 'changes') {
                const group = changelistGroups.get(INACTIVE_CHANGELIST_ID);
                if (group) {
                    group.push(toDisplayFile(file));
                }
            } else {
                inactiveFiles.push(toDisplayFile(file));
            }
            return;
        }

        const assignment: ChangelistAssignment | undefined = changelistState.assignments[file.path];

        if (file.status === '?') {
            if (changelistState.mode === 'changes' && assignment?.fileListId) {
                const group = changelistGroups.get(assignment.fileListId);
                if (group) {
                    group.push(toDisplayFile(file));
                    return;
                }
            }

            untrackedFiles.push(toDisplayFile(file));
            return;
        }

        const inactiveHunks = getInactiveHunks(file);
        const activeHunks = getActiveHunks(file);

        if (inactiveHunks.length > 0 && changelistState.mode === 'changes') {
            const group = changelistGroups.get(INACTIVE_CHANGELIST_ID);
            if (group) {
                group.push(toDisplayFile(file, inactiveHunks, true));
            }
        } else if (inactiveHunks.length > 0) {
            inactiveFiles.push(toDisplayFile(file, inactiveHunks, true));
        }

        if (file.hunks.length > 0) {
            if (activeHunks.length === 0) {
                return;
            }

            const hunksByList = new Map<string, GitHunk[]>();

            activeHunks.forEach(hunk => {
                const listId = getAssignedHunkListId(hunk.id, assignment) || changelistState.activeListId;
                const group = hunksByList.get(listId) || [];
                group.push(hunk);
                hunksByList.set(listId, group);
            });

            hunksByList.forEach((hunks, listId) => {
                const group = changelistGroups.get(listId);
                if (group) {
                    group.push(toDisplayFile(file, hunks));
                }
            });
            return;
        }

        const listId = assignment?.fileListId || changelistState.activeListId;
        const group = changelistGroups.get(listId);
        if (group) {
            group.push(toDisplayFile(file));
        }
    });

    const result: ChangelistGroup[] = [];

    if (changelistState.mode === 'staged') {
        const stagedFiles = files
            .filter(file => file.staged && file.status !== '?')
            .map(toActiveFileStatus)
            .filter((file): file is FileStatus => Boolean(file));
        const changesFiles = files
            .filter(file => !file.staged && file.status !== '?')
            .map(toActiveFileStatus)
            .filter((file): file is FileStatus => Boolean(file));

        result.push({
            id: 'staged-changes',
            name: t('Staged Changes'),
            isDefault: false,
            isActive: false,
            items: stagedFiles
        });

        result.push({
            id: 'changes',
            name: t('Changes'),
            isDefault: true,
            isActive: true,
            items: changesFiles
        });
    } else {
        changelistState.lists.forEach(list => {
            result.push({
                id: list.id,
                name: list.name,
                isDefault: list.isDefault,
                isActive: list.isActive,
                items: changelistGroups.get(list.id) || []
            });
        });
    }

    if (untrackedFiles.length > 0) {
        result.push({
            id: 'untracked-changes',
            name: t('Untracked Changes'),
            isDefault: false,
            isActive: false,
            items: untrackedFiles
        });
    }

    if (changelistState.mode === 'staged') {
        result.push({
            id: INACTIVE_CHANGELIST_ID,
            name: t('Inactive Changes'),
            isDefault: false,
            isActive: false,
            items: inactiveFiles,
            hasWarning: inactiveFiles.some(file => file.hasStagedInactive)
        });
    }

    return result;
}

export function getSelectedFiles(files: FileStatus[], changelists: ChangelistGroup[], changelistState: ChangelistState): Set<string> {
    if (changelistState.mode === 'staged') {
        return new Set(files.filter(file => file.staged && !hasOnlyInactiveHunks(file)).map(file => file.path));
    }

    const activeGroup = changelists.find(group => group.isActive);
    const next = new Set(activeGroup?.items.map(file => file.path) || []);
    const untrackedGroup = changelists.find(group => group.id === 'untracked-changes');
    untrackedGroup?.items.forEach(file => next.add(file.path));
    return next;
}

export function getFileStats(changelists: ChangelistGroup[], selectedFiles: Set<string>): { added: number; modified: number; deleted: number } {
    let added = 0;
    let modified = 0;
    let deleted = 0;

    changelists.forEach(group => {
        group.items.forEach(file => {
            if (!selectedFiles.has(file.path)) {
                return;
            }

            const status = file.status.trim().toUpperCase();
            if (status.startsWith('A') || status === '?' || status === 'U') {
                added++;
            } else if (status.startsWith('D')) {
                deleted++;
            } else {
                modified++;
            }
        });
    });

    return { added, modified, deleted };
}

export function hasTrackedChanges(files: FileStatus[]): boolean {
    return files.some(file => !hasOnlyInactiveHunks(file) && file.status !== '?' && file.status !== 'C' && file.status !== 'U' && !file.staged);
}

export function buildSplitInfoByPath(groups: ChangelistGroup[]): Map<string, SplitFileInfo> {
    const groupNamesByPath = new Map<string, Set<string>>();

    groups.forEach(group => {
        group.items.forEach(file => {
            const groupNames = groupNamesByPath.get(file.path) || new Set<string>();
            groupNames.add(group.name);
            groupNamesByPath.set(file.path, groupNames);
        });
    });

    const result = new Map<string, SplitFileInfo>();
    groupNamesByPath.forEach((groupNames, path) => {
        if (groupNames.size < 2) {
            return;
        }

        result.set(path, {
            groupCount: groupNames.size,
            groupNames: Array.from(groupNames)
        });
    });

    return result;
}
