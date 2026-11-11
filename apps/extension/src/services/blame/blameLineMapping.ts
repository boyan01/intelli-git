export interface DiffHunkRange {
    oldStart: number;
    oldCount: number;
    newStart: number;
    newCount: number;
}

const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Reads the hunk headers of a unified diff, in order.
 */
export function parseDiffHunkRanges(diff: string): DiffHunkRange[] {
    const hunks: DiffHunkRange[] = [];
    for (const row of diff.split('\n')) {
        const match = HUNK_HEADER_PATTERN.exec(row);
        if (match) {
            hunks.push({
                oldStart: Number(match[1]),
                oldCount: match[2] === undefined ? 1 : Number(match[2]),
                newStart: Number(match[3]),
                newCount: match[4] === undefined ? 1 : Number(match[4]),
            });
        }
    }
    return hunks;
}

/**
 * Maps a one-based line of the new side of a diff to the matching line of the old side.
 * Unchanged lines keep their content; a changed line maps to the line it replaced, and an added
 * line maps to where it was inserted.
 */
export function mapNewLineToOldLine(hunks: readonly DiffHunkRange[], newLine: number): number {
    let offset = 0;
    for (const hunk of hunks) {
        // A zero count means the hunk sits right after the given line.
        const newStart = hunk.newCount === 0 ? hunk.newStart + 1 : hunk.newStart;
        const oldStart = hunk.oldCount === 0 ? hunk.oldStart + 1 : hunk.oldStart;
        if (newLine < newStart) {
            break;
        }
        const newEnd = newStart + hunk.newCount;
        if (newLine < newEnd) {
            return oldStart + Math.min(newLine - newStart, Math.max(0, hunk.oldCount - 1));
        }
        offset = oldStart + hunk.oldCount - newEnd;
    }
    return Math.max(1, newLine + offset);
}
