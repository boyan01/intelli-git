import type { WorktreeInfo } from '@shared/messages';

/** Splits a path into its parent (including the trailing separator) and its folder name. */
export function splitFolderPath(worktreePath: string): { parent: string; folder: string } {
    const trimmed = worktreePath.replace(/[\\/]+$/, '');
    const separatorIndex = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
    return {
        parent: trimmed.slice(0, separatorIndex + 1),
        folder: trimmed.slice(separatorIndex + 1),
    };
}

function getSortRank(worktree: WorktreeInfo): number {
    if (!worktree.pathExists) {
        return 2;
    }
    return worktree.isMain ? 0 : 1;
}

/** Main worktree first, then linked worktrees by branch name, missing worktrees last. */
export function sortWorktrees(worktrees: WorktreeInfo[]): WorktreeInfo[] {
    return [...worktrees].sort((a, b) => {
        const rankDiff = getSortRank(a) - getSortRank(b);
        if (rankDiff !== 0) {
            return rankDiff;
        }
        const refDiff = (a.branch ?? a.head ?? '').localeCompare(b.branch ?? b.head ?? '');
        return refDiff !== 0 ? refDiff : a.path.localeCompare(b.path);
    });
}
