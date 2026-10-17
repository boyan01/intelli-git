import type { GitHunk } from '@shared/messages';

export interface HunkSignature {
    id: string;
    oldStart: number;
    oldLineCount?: number;
    newStart: number;
    newLineCount?: number;
}

const HUNK_MATCH_THRESHOLD = 24;

export function parseHunkSignature(hunkId: string): HunkSignature | null {
    // Older releases tracked index and worktree change blocks separately; their ids still
    // carry an `index:` or `worktree:` prefix and are remapped onto HEAD-relative blocks.
    const newFormatMatch = hunkId.match(/(?::|^)(?:head|index|worktree):(\d+):(\d+):(\d+):(\d+):[a-z0-9]+$/);
    if (newFormatMatch) {
        return {
            id: hunkId,
            oldStart: Number(newFormatMatch[1]),
            oldLineCount: Number(newFormatMatch[2]),
            newStart: Number(newFormatMatch[3]),
            newLineCount: Number(newFormatMatch[4]),
        };
    }

    const oldFormatMatch = hunkId.match(/:(\d+):(\d+)$/);
    if (!oldFormatMatch) {
        return null;
    }

    return {
        id: hunkId,
        oldStart: Number(oldFormatMatch[1]),
        newStart: Number(oldFormatMatch[2]),
    };
}

export function signatureFromHunk(hunk: GitHunk): HunkSignature {
    return {
        id: hunk.id,
        oldStart: hunk.oldStart,
        oldLineCount: hunk.oldLineCount,
        newStart: hunk.newStart,
        newLineCount: hunk.newLineCount,
    };
}

export function getHunkMatchScore(previous: HunkSignature, current: HunkSignature): number {
    const oldStartDelta = Math.abs(previous.oldStart - current.oldStart);
    const newStartDelta = Math.abs(previous.newStart - current.newStart);
    const oldCountDelta = Math.abs((previous.oldLineCount ?? 1) - (current.oldLineCount ?? 1));
    const newCountDelta = Math.abs((previous.newLineCount ?? 1) - (current.newLineCount ?? 1));

    return oldStartDelta * 2 + newStartDelta * 2 + oldCountDelta + newCountDelta;
}

/**
 * Carries values over from previous change block ids to the current ones by line position.
 * When several previous blocks merge into one current block (for example a staged and an
 * unstaged edit of the same lines), `mergeValues` decides which value the merged block keeps.
 */
export function remapHunkValues<T>(
    hunks: GitHunk[],
    previousValues: Record<string, T> | undefined,
    createDefaultValue: (hunkId: string) => T,
    mergeValues: (current: T, merged: T) => T = (current) => current
): Record<string, T> {
    const nextValues: Record<string, T> = {};
    if (!previousValues) {
        for (const hunk of hunks) {
            nextValues[hunk.id] = createDefaultValue(hunk.id);
        }
        return nextValues;
    }

    const currentIds = new Set(hunks.map((hunk) => hunk.id));
    const unmatchedHunks = new Map(hunks.map((hunk) => [hunk.id, signatureFromHunk(hunk)]));
    const remappedHunks = new Map<string, HunkSignature>();
    const staleEntries: Array<[HunkSignature, T]> = [];

    for (const [hunkId, value] of Object.entries(previousValues)) {
        if (currentIds.has(hunkId)) {
            nextValues[hunkId] = value;
            unmatchedHunks.delete(hunkId);
            continue;
        }

        const signature = parseHunkSignature(hunkId);
        if (signature) {
            staleEntries.push([signature, value]);
        }
    }

    const findBestMatch = (previousSignature: HunkSignature, candidates: Iterable<HunkSignature>) => {
        let bestMatch: HunkSignature | null = null;
        let bestScore = Number.MAX_SAFE_INTEGER;

        for (const currentSignature of candidates) {
            const score = getHunkMatchScore(previousSignature, currentSignature);
            if (score < bestScore) {
                bestScore = score;
                bestMatch = currentSignature;
            }
        }

        return bestMatch && bestScore <= HUNK_MATCH_THRESHOLD ? bestMatch : null;
    };

    for (const [previousSignature, value] of staleEntries) {
        const unmatched = findBestMatch(previousSignature, unmatchedHunks.values());
        if (unmatched) {
            nextValues[unmatched.id] = value;
            unmatchedHunks.delete(unmatched.id);
            remappedHunks.set(unmatched.id, unmatched);
            continue;
        }

        const merged = findBestMatch(previousSignature, remappedHunks.values());
        if (merged) {
            nextValues[merged.id] = mergeValues(nextValues[merged.id], value);
        }
    }

    for (const hunkId of unmatchedHunks.keys()) {
        nextValues[hunkId] = createDefaultValue(hunkId);
    }

    return nextValues;
}
