import type { WorktreeInfo } from '@shared/messages';

function splitPath(worktreePath: string): string[] {
    return worktreePath.split(/[\\/]/).filter(Boolean);
}

/**
 * Maps each path to its shortest trailing segment run that is unique among all paths,
 * the same way VS Code disambiguates editor tabs with identical file names.
 */
export function getShortestUniqueSuffixes(paths: string[]): Map<string, string> {
    const uniquePaths = Array.from(new Set(paths));
    const segmentsByPath = new Map(uniquePaths.map((worktreePath) => [worktreePath, splitPath(worktreePath)]));
    const depthByPath = new Map(uniquePaths.map((worktreePath) => [worktreePath, 1]));
    const getSuffix = (worktreePath: string) => {
        const segments = segmentsByPath.get(worktreePath) ?? [];
        return segments.slice(-(depthByPath.get(worktreePath) ?? 1)).join('/');
    };

    let changed = true;
    while (changed) {
        changed = false;
        const pathsBySuffix = new Map<string, string[]>();
        for (const worktreePath of uniquePaths) {
            const suffix = getSuffix(worktreePath);
            pathsBySuffix.set(suffix, [...(pathsBySuffix.get(suffix) ?? []), worktreePath]);
        }

        for (const group of pathsBySuffix.values()) {
            if (group.length < 2) {
                continue;
            }
            for (const worktreePath of group) {
                const depth = depthByPath.get(worktreePath) ?? 1;
                if (depth < (segmentsByPath.get(worktreePath)?.length ?? 0)) {
                    depthByPath.set(worktreePath, depth + 1);
                    changed = true;
                }
            }
        }
    }

    return new Map(uniquePaths.map((worktreePath) => [worktreePath, getSuffix(worktreePath)]));
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
