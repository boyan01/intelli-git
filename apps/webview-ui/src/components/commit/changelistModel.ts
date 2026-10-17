import type {
    ChangelistGroup,
    ChangelistState,
    FileStatus,
    GitHunk,
    RepositoryCommitViewState,
    RepositoryFileReference,
    RepositoryInfo,
} from '@shared/messages';
import {
    buildLogicalFiles,
    isConflictStatus,
    splitFileByChangelist,
    type LogicalFile,
} from '@shared/changelistRouting';

export const CONFLICTING_CHANGES_ID = 'conflicting-changes';

type Translate = (key: string) => string;

export interface SplitFileInfo {
    groupCount: number;
    groupNames: string[];
}

export interface RepositoryChangelistGroup {
    repository: RepositoryInfo;
    workspaceRoot: string;
    changelistState: ChangelistState;
    group: ChangelistGroup;
}

export interface WorkspaceChangelistGroup extends ChangelistGroup {
    repositories: RepositoryChangelistGroup[];
}

export interface RepositoryFileSelection extends RepositoryFileReference {
    status?: FileStatus['status'];
    staged?: boolean;
}

export function getSelectionKey(repoPath: string | undefined, filePath: string): string {
    return `${repoPath || ''}\u0000${filePath}`;
}

function toDisplayFile(file: LogicalFile, hunks?: GitHunk[]): FileStatus {
    return {
        path: file.path,
        status: file.status,
        staged: false,
        hunks,
        resolvedCandidate: file.resolvedCandidate,
        error: file.error,
        reviewed: file.reviewed,
    };
}

/**
 * Builds the commit view groups. Staged mode mirrors the Git index; changes mode routes every
 * change, including new untracked files, through the changelist rules shared with the commit plan.
 */
export function buildChangelists(
    files: FileStatus[],
    changelistState: ChangelistState,
    t: Translate
): ChangelistGroup[] {
    const logicalFiles = buildLogicalFiles(files);
    const result: ChangelistGroup[] = [];

    const conflictFiles = logicalFiles
        .filter((file) => isConflictStatus(file.status))
        .map((file) => toDisplayFile(file));
    if (conflictFiles.length > 0) {
        result.push({
            id: CONFLICTING_CHANGES_ID,
            name: t('Conflicting Changes'),
            isDefault: false,
            isActive: false,
            items: conflictFiles,
        });
    }

    if (changelistState.mode === 'staged') {
        const trackedFiles = files.filter((file) => !isConflictStatus(file.status));
        result.push(
            {
                id: 'staged-changes',
                name: t('Staged Changes'),
                isDefault: false,
                isActive: false,
                items: trackedFiles.filter((file) => file.staged),
            },
            {
                id: 'changes',
                name: t('Changes'),
                isDefault: true,
                isActive: true,
                items: trackedFiles.filter((file) => !file.staged),
            }
        );
        return result;
    }

    const itemsByList = new Map<string, FileStatus[]>(changelistState.lists.map((list) => [list.id, []]));
    logicalFiles.forEach((file) => {
        if (isConflictStatus(file.status)) {
            return;
        }

        splitFileByChangelist(file.hunks, changelistState.assignments[file.path], changelistState.activeListId).forEach(
            (slice) => {
                const items = itemsByList.get(slice.listId) || itemsByList.get(changelistState.activeListId);
                items?.push(toDisplayFile(file, slice.hunks));
            }
        );
    });

    changelistState.lists.forEach((list) => {
        result.push({
            id: list.id,
            name: list.name,
            isDefault: list.isDefault,
            isActive: list.isActive,
            items: itemsByList.get(list.id) || [],
        });
    });

    return result;
}

export function getSelectedFiles(
    files: FileStatus[],
    changelists: ChangelistGroup[],
    changelistState: ChangelistState
): Set<string> {
    if (changelistState.mode === 'staged') {
        return new Set(files.filter((file) => file.staged).map((file) => file.path));
    }

    const activeGroup = changelists.find((group) => group.isActive);
    return new Set(activeGroup?.items.map((file) => file.path) || []);
}

export function getFileStats(
    changelists: ChangelistGroup[],
    selectedFiles: Set<string>
): { added: number; modified: number; deleted: number } {
    let added = 0;
    let modified = 0;
    let deleted = 0;

    changelists.forEach((group) => {
        group.items.forEach((file) => {
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
    return files.some((file) => file.status !== '?' && file.status !== 'C' && file.status !== 'U' && !file.staged);
}

export function buildSplitInfoByPath(groups: ChangelistGroup[]): Map<string, SplitFileInfo> {
    const groupNamesByPath = new Map<string, Set<string>>();

    groups.forEach((group) => {
        group.items.forEach((file) => {
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
            groupNames: Array.from(groupNames),
        });
    });

    return result;
}

function getWorkspaceGroupKey(group: ChangelistGroup): string {
    if (group.id === 'staged-changes' || group.id === 'changes' || group.id === CONFLICTING_CHANGES_ID) {
        return group.id;
    }

    return `custom:${group.name}`;
}

export function buildWorkspaceChangelists(
    repositories: RepositoryCommitViewState[],
    t: Translate
): WorkspaceChangelistGroup[] {
    const groups = new Map<string, WorkspaceChangelistGroup>();

    repositories.forEach((repositoryState) => {
        const repoGroups = buildChangelists(repositoryState.files, repositoryState.changelistState, t);
        repoGroups.forEach((group) => {
            const key = getWorkspaceGroupKey(group);
            const existing = groups.get(key);
            const repositoryGroup: RepositoryChangelistGroup = {
                repository: repositoryState.repository,
                workspaceRoot: repositoryState.workspaceRoot,
                changelistState: repositoryState.changelistState,
                group,
            };

            if (existing) {
                existing.items.push(...group.items);
                existing.repositories.push(repositoryGroup);
                existing.isActive = existing.isActive || group.isActive;
                return;
            }

            groups.set(key, {
                ...group,
                id: key,
                items: [...group.items],
                repositories: [repositoryGroup],
            });
        });
    });

    return Array.from(groups.values()).filter(
        (group) =>
            group.repositories.some((repoGroup) => repoGroup.group.items.length > 0) ||
            group.id === 'staged-changes' ||
            group.id === 'changes'
    );
}

export function getWorkspaceSelectedFiles(
    groups: WorkspaceChangelistGroup[],
    changelistState: ChangelistState
): Map<string, RepositoryFileSelection> {
    const selected = new Map<string, RepositoryFileSelection>();

    groups.forEach((group) => {
        group.repositories.forEach((repoGroup) => {
            const shouldSelect =
                changelistState.mode === 'staged' ? repoGroup.group.id === 'staged-changes' : repoGroup.group.isActive;

            if (!shouldSelect) {
                return;
            }

            repoGroup.group.items.forEach((file) => {
                selected.set(getSelectionKey(repoGroup.repository.repoPath, file.path), {
                    repoPath: repoGroup.repository.repoPath,
                    path: file.path,
                    status: file.status,
                    staged: file.staged,
                });
            });
        });
    });

    return selected;
}

export function getWorkspaceFileStats(
    groups: WorkspaceChangelistGroup[],
    selectedFiles: Map<string, RepositoryFileSelection>
): { added: number; modified: number; deleted: number } {
    let added = 0;
    let modified = 0;
    let deleted = 0;

    groups.forEach((group) => {
        group.repositories.forEach((repoGroup) => {
            repoGroup.group.items.forEach((file) => {
                if (!selectedFiles.has(getSelectionKey(repoGroup.repository.repoPath, file.path))) {
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
    });

    return { added, modified, deleted };
}

export function hasWorkspaceTrackedChanges(repositories: RepositoryCommitViewState[]): boolean {
    return repositories.some((repository) => hasTrackedChanges(repository.files));
}
