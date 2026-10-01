import { describe, expect, it } from 'vitest';
import type { CommitFile } from '@shared/messages';
import { getInlineDetailsHeight, getInlineFileSummary } from './inlineCommitLayout';

function file(path: string, displayPath?: string): CommitFile {
    return {
        path,
        displayPath,
        status: 'M',
    };
}

describe('inlineCommitLayout', () => {
    it('uses compact content-height estimates for small expanded commits', () => {
        expect(
            getInlineDetailsHeight({
                body: '',
                files: [],
            })
        ).toBe(27);

        expect(
            getInlineDetailsHeight({
                body: 'Document the commit flow',
                files: [file('README.md')],
            })
        ).toBe(66);
    });

    it('caps wrapped body height to keep expanded commit rows compact', () => {
        expect(
            getInlineDetailsHeight({
                body: 'A very long body line that should wrap several times in the compact inline commit summary and stay capped instead of pushing the row into a full details panel. '.repeat(
                    3
                ),
                files: [file('src/a.ts'), file('src/b.ts')],
            })
        ).toBe(100);
    });

    it('summarizes the first files and reports remaining files', () => {
        expect(
            getInlineFileSummary([file('src/a.ts'), file('src/b.ts', 'b.ts'), file('src/c.ts'), file('src/d.ts')])
        ).toEqual({
            visibleFiles: ['src/a.ts', 'b.ts', 'src/c.ts'],
            moreCount: 1,
            totalCount: 4,
        });
    });
});
