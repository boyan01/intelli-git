import type { GitHunk } from '@shared/messages';

export interface HunkSignature {
    id: string;
    side?: 'index' | 'worktree';
    oldStart: number;
    oldLineCount?: number;
    newStart: number;
    newLineCount?: number;
}

const HUNK_MATCH_THRESHOLD = 24;

export function parseHunkSignature(hunkId: string): HunkSignature | null {
    const newFormatMatch = hunkId.match(/(?::|^)(index|worktree):(\d+):(\d+):(\d+):(\d+):[a-z0-9]+$/);
    if (newFormatMatch) {
        return {
            id: hunkId,
            side: newFormatMatch[1] as 'index' | 'worktree',
            oldStart: Number(newFormatMatch[2]),
            oldLineCount: Number(newFormatMatch[3]),
            newStart: Number(newFormatMatch[4]),
            newLineCount: Number(newFormatMatch[5]),
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
        side: hunk.id.includes(':index:') ? 'index' : hunk.id.includes(':worktree:') ? 'worktree' : undefined,
        oldStart: hunk.oldStart,
        oldLineCount: hunk.oldLineCount,
        newStart: hunk.newStart,
        newLineCount: hunk.newLineCount,
    };
}

export function getHunkMatchScore(previous: HunkSignature, current: HunkSignature): number {
    if (previous.side && current.side && previous.side !== current.side) {
        return Number.MAX_SAFE_INTEGER;
    }

    const sidePenalty = previous.side || current.side ? 0 : 4;
    const oldStartDelta = Math.abs(previous.oldStart - current.oldStart);
    const newStartDelta = Math.abs(previous.newStart - current.newStart);
    const oldCountDelta = Math.abs((previous.oldLineCount ?? 1) - (current.oldLineCount ?? 1));
    const newCountDelta = Math.abs((previous.newLineCount ?? 1) - (current.newLineCount ?? 1));

    return sidePenalty + oldStartDelta * 2 + newStartDelta * 2 + oldCountDelta + newCountDelta;
}

export function remapHunkValues<T>(
    hunks: GitHunk[],
    previousValues: Record<string, T> | undefined,
    createDefaultValue: (hunkId: string) => T
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

    for (const [previousSignature, value] of staleEntries) {
        let bestMatch: HunkSignature | null = null;
        let bestScore = Number.MAX_SAFE_INTEGER;

        for (const currentSignature of unmatchedHunks.values()) {
            const score = getHunkMatchScore(previousSignature, currentSignature);
            if (score < bestScore) {
                bestScore = score;
                bestMatch = currentSignature;
            }
        }

        if (bestMatch && bestScore <= HUNK_MATCH_THRESHOLD) {
            nextValues[bestMatch.id] = value;
            unmatchedHunks.delete(bestMatch.id);
        }
    }

    for (const hunkId of unmatchedHunks.keys()) {
        nextValues[hunkId] = createDefaultValue(hunkId);
    }

    return nextValues;
}

export function remapHunkIdSet(hunks: GitHunk[], previousHunkIds: string[]): string[] {
    const currentIds = new Set(hunks.map((hunk) => hunk.id));
    const unmatchedHunks = new Map(hunks.map((hunk) => [hunk.id, signatureFromHunk(hunk)]));
    const nextHunkIds = new Set<string>();
    const staleSignatures: HunkSignature[] = [];

    for (const hunkId of previousHunkIds) {
        if (currentIds.has(hunkId)) {
            nextHunkIds.add(hunkId);
            unmatchedHunks.delete(hunkId);
            continue;
        }

        const signature = parseHunkSignature(hunkId);
        if (signature) {
            staleSignatures.push(signature);
        }
    }

    for (const previousSignature of staleSignatures) {
        let bestMatch: HunkSignature | null = null;
        let bestScore = Number.MAX_SAFE_INTEGER;

        for (const currentSignature of unmatchedHunks.values()) {
            const score = getHunkMatchScore(previousSignature, currentSignature);
            if (score < bestScore) {
                bestScore = score;
                bestMatch = currentSignature;
            }
        }

        if (bestMatch && bestScore <= HUNK_MATCH_THRESHOLD) {
            nextHunkIds.add(bestMatch.id);
            unmatchedHunks.delete(bestMatch.id);
        }
    }

    return Array.from(nextHunkIds);
}
