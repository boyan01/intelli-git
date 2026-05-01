import { describe, expect, it } from 'vitest';
import { parseDiffToHunks } from './diffParser';

describe('parseDiffToHunks', () => {
    it('parses multiple hunks with shared file headers', () => {
        const diff = [
            'diff --git a/src/file.ts b/src/file.ts',
            'index 1111111..2222222 100644',
            '--- a/src/file.ts',
            '+++ b/src/file.ts',
            '@@ -1,3 +1,4 @@',
            ' line one',
            '-line two',
            '+line two changed',
            '+line three',
            ' line four',
            '@@ -10 +11 @@',
            '-old',
            '+new'
        ].join('\n');

        const hunks = parseDiffToHunks(diff, 'src/file.ts');

        expect(hunks).toHaveLength(2);
        expect(hunks[0]).toMatchObject({
            id: 'src/file.ts:1:1',
            lineRange: 'L1-3 / L1-4',
            oldStart: 1,
            oldLineCount: 3,
            newStart: 1,
            newLineCount: 4
        });
        expect(hunks[0].fileHeader).toBe([
            'diff --git a/src/file.ts b/src/file.ts',
            'index 1111111..2222222 100644',
            '--- a/src/file.ts',
            '+++ b/src/file.ts'
        ].join('\n'));
        expect(hunks[0].content).toContain('+line two changed');
        expect(hunks[1]).toMatchObject({
            id: 'src/file.ts:10:11',
            lineRange: 'L10-10 / L11-11',
            oldLineCount: 1,
            newLineCount: 1
        });
    });

    it('keeps added-file zero line counts in hunk ranges', () => {
        const diff = [
            'diff --git a/new.txt b/new.txt',
            'new file mode 100644',
            'index 0000000..1111111',
            '--- /dev/null',
            '+++ b/new.txt',
            '@@ -0,0 +1,2 @@',
            '+first',
            '+second'
        ].join('\n');

        const hunks = parseDiffToHunks(diff, 'new.txt');

        expect(hunks).toHaveLength(1);
        expect(hunks[0]).toMatchObject({
            id: 'new.txt:0:1',
            lineRange: 'L0--1 / L1-2',
            oldStart: 0,
            oldLineCount: 0,
            newStart: 1,
            newLineCount: 2
        });
    });
});
