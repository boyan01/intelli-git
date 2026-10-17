import type { ChangelistAssignment, FileStatus, GitHunk } from './messages';

/**
 * Changelist routing rules shared by the commit view (what is shown where) and the
 * extension commit plan (what is committed). Keeping one implementation prevents the
 * displayed changelist and the committed changelist from drifting apart.
 */

export interface LogicalFile {
    path: string;
    status: FileStatus['status'];
    entries: FileStatus[];
    /** HEAD-relative change blocks, de-duplicated across the staged and unstaged entries. */
    hunks: GitHunk[];
    staged: boolean;
    resolvedCandidate?: boolean;
    error?: boolean;
    reviewed?: boolean;
}

export interface ChangelistSlice {
    listId: string;
    /** The file's change blocks routed to this list; undefined when the file moves as a whole. */
    hunks?: GitHunk[];
}

export function isConflictStatus(status: FileStatus['status']): boolean {
    return status === 'C' || status === 'U';
}

function getLogicalStatus(entries: FileStatus[]): FileStatus['status'] {
    if (entries.some((entry) => isConflictStatus(entry.status))) {
        return 'C';
    }
    if (entries.some((entry) => entry.status === '?')) {
        return '?';
    }
    if (entries.some((entry) => entry.status === 'D')) {
        return 'D';
    }
    if (entries.some((entry) => entry.status === 'A')) {
        return 'A';
    }
    return entries[0]?.status || 'M';
}

/** Collapses the per-index/per-worktree status entries of each path into one logical file. */
export function buildLogicalFiles(files: FileStatus[]): LogicalFile[] {
    const grouped = new Map<string, FileStatus[]>();
    files.forEach((file) => {
        const entries = grouped.get(file.path) || [];
        entries.push(file);
        grouped.set(file.path, entries);
    });

    return Array.from(grouped.entries()).map(([path, entries]) => ({
        path,
        status: getLogicalStatus(entries),
        entries,
        hunks: Array.from(
            new Map(entries.flatMap((entry) => (entry.hunks || []).map((hunk) => [hunk.id, hunk]))).values()
        ),
        staged: entries.some((entry) => entry.staged),
        resolvedCandidate: entries.some((entry) => entry.resolvedCandidate) || undefined,
        error: entries.some((entry) => entry.error) || undefined,
        reviewed: entries.some((entry) => entry.reviewed) || undefined,
    }));
}

/**
 * Splits one file's changes across changelists. Unassigned change blocks belong to the
 * active changelist; files without change blocks (untracked, binary) move as a whole.
 */
export function splitFileByChangelist(
    hunks: GitHunk[],
    assignment: ChangelistAssignment | undefined,
    activeListId: string
): ChangelistSlice[] {
    if (hunks.length === 0) {
        return [{ listId: assignment?.fileListId || activeListId }];
    }

    const hunksByList = new Map<string, GitHunk[]>();
    for (const hunk of hunks) {
        const listId = assignment?.hunkListIds?.[hunk.id] || assignment?.fileListId || activeListId;
        const listHunks = hunksByList.get(listId) || [];
        listHunks.push(hunk);
        hunksByList.set(listId, listHunks);
    }

    return Array.from(hunksByList.entries()).map(([listId, listHunks]) => ({ listId, hunks: listHunks }));
}
