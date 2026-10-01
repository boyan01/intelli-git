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
            '+new',
        ].join('\n');

        const hunks = parseDiffToHunks(diff, 'src/file.ts');

        expect(hunks).toHaveLength(2);
        expect(hunks[0]).toMatchObject({
            lineRange: 'L2-2 / L2-3',
            oldStart: 2,
            oldLineCount: 1,
            newStart: 2,
            newLineCount: 2,
        });
        expect(hunks[0].id).toMatch(/^src\/file\.ts:2:1:2:2:/);
        expect(hunks[0].fileHeader).toBe(
            [
                'diff --git a/src/file.ts b/src/file.ts',
                'index 1111111..2222222 100644',
                '--- a/src/file.ts',
                '+++ b/src/file.ts',
            ].join('\n')
        );
        expect(hunks[0].content).toContain('+line two changed');
        expect(hunks[1]).toMatchObject({
            lineRange: 'L10-10 / L11-11',
            oldLineCount: 1,
            newLineCount: 1,
        });
        expect(hunks[1].id).toMatch(/^src\/file\.ts:10:1:11:1:/);
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
            '+second',
        ].join('\n');

        const hunks = parseDiffToHunks(diff, 'new.txt');

        expect(hunks).toHaveLength(1);
        expect(hunks[0]).toMatchObject({
            lineRange: 'L0-0 / L1-2',
            oldStart: 0,
            oldLineCount: 0,
            newStart: 1,
            newLineCount: 2,
        });
        expect(hunks[0].id).toMatch(/^new\.txt:0:0:1:2:/);
    });

    it('splits nearby additions inside one git hunk into change blocks', () => {
        const diff = [
            'diff --git a/docs/shared.txt b/docs/shared.txt',
            'index 48eadb2..73843a9 100644',
            '--- a/docs/shared.txt',
            '+++ b/docs/shared.txt',
            '@@ -1,2 +1,8 @@',
            '+',
            '+1 let 2414',
            ' shared-on-main',
            '+12ce',
            ' main-second-line',
            '+',
            '+2',
            '+12',
        ].join('\n');

        const hunks = parseDiffToHunks(diff, 'docs/shared.txt', { idPrefix: 'worktree' });

        expect(hunks).toHaveLength(3);
        expect(hunks.map((hunk) => hunk.lineRange)).toEqual(['L1-1 / L1-2', 'L2-2 / L4-4', 'L3-3 / L6-8']);
        expect(hunks[2].id).toMatch(/^docs\/shared\.txt:worktree:3:0:6:3:/);
        expect(hunks[2].content).toContain(' main-second-line');
        expect(hunks[2].content).toContain('+12');
    });
});
