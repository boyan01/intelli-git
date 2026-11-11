import { describe, expect, it } from 'vitest';
import { mapNewLineToOldLine, parseDiffHunkRanges } from './blameLineMapping';

describe('parseDiffHunkRanges', () => {
    it('reads hunk headers with and without counts', () => {
        expect(
            parseDiffHunkRanges(
                ['diff --git a/x b/x', '@@ -1,0 +2,3 @@ fn', '+a', '@@ -10 +13,0 @@', '-b', '@@ -20,2 +22 @@'].join(
                    '\n'
                )
            )
        ).toEqual([
            { oldStart: 1, oldCount: 0, newStart: 2, newCount: 3 },
            { oldStart: 10, oldCount: 1, newStart: 13, newCount: 0 },
            { oldStart: 20, oldCount: 2, newStart: 22, newCount: 1 },
        ]);
    });
});

describe('mapNewLineToOldLine', () => {
    it('keeps lines when nothing changed', () => {
        expect(mapNewLineToOldLine([], 7)).toBe(7);
    });

    it('shifts lines below added lines', () => {
        // Three lines inserted after old line 1.
        const hunks = [{ oldStart: 1, oldCount: 0, newStart: 2, newCount: 3 }];
        expect(mapNewLineToOldLine(hunks, 1)).toBe(1);
        expect(mapNewLineToOldLine(hunks, 2)).toBe(2);
        expect(mapNewLineToOldLine(hunks, 4)).toBe(2);
        expect(mapNewLineToOldLine(hunks, 5)).toBe(2);
        expect(mapNewLineToOldLine(hunks, 8)).toBe(5);
    });

    it('shifts lines below removed lines', () => {
        // Old lines 3-4 removed; they sat after new line 2.
        const hunks = [{ oldStart: 3, oldCount: 2, newStart: 2, newCount: 0 }];
        expect(mapNewLineToOldLine(hunks, 2)).toBe(2);
        expect(mapNewLineToOldLine(hunks, 3)).toBe(5);
    });

    it('maps changed lines to the lines they replaced', () => {
        const hunks = [
            { oldStart: 2, oldCount: 1, newStart: 2, newCount: 3 },
            { oldStart: 10, oldCount: 2, newStart: 12, newCount: 2 },
        ];
        expect(mapNewLineToOldLine(hunks, 3)).toBe(2);
        expect(mapNewLineToOldLine(hunks, 5)).toBe(3);
        expect(mapNewLineToOldLine(hunks, 13)).toBe(11);
        expect(mapNewLineToOldLine(hunks, 20)).toBe(18);
    });
});
