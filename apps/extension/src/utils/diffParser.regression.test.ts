import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseDiffToFileHunks } from './diffParser';

test('parseDiffToFileHunks keeps multi-file hunks under the correct path with stable id shape', () => {
    const diff = [
        'diff --git a/src/alpha.ts b/src/alpha.ts',
        'index 1111111..2222222 100644',
        '--- a/src/alpha.ts',
        '+++ b/src/alpha.ts',
        '@@ -1,3 +1,4 @@',
        ' line 1',
        '-line 2',
        '+line two',
        '+line 2.5',
        ' line 3',
        '@@ -20,2 +21,2 @@',
        '-old alpha',
        '+new alpha',
        'diff --git a/src/beta.ts b/src/beta.ts',
        'index 3333333..4444444 100644',
        '--- a/src/beta.ts',
        '+++ b/src/beta.ts',
        '@@ -5 +5 @@',
        '-old beta',
        '+new beta'
    ].join('\n');

    const hunksByPath = parseDiffToFileHunks(diff, repoPath => repoPath, { idPrefix: 'worktree' });

    assert.deepEqual([...hunksByPath.keys()], ['src/alpha.ts', 'src/beta.ts']);

    const alphaHunks = hunksByPath.get('src/alpha.ts')!;
    const betaHunks = hunksByPath.get('src/beta.ts')!;

    assert.equal(alphaHunks.length, 2);
    assert.equal(betaHunks.length, 1);
    assert.match(alphaHunks[0].id, /^src\/alpha\.ts:worktree:2:1:2:2:[a-z0-9]+$/);
    assert.match(alphaHunks[1].id, /^src\/alpha\.ts:worktree:20:1:21:1:[a-z0-9]+$/);
    assert.match(betaHunks[0].id, /^src\/beta\.ts:worktree:5:1:5:1:[a-z0-9]+$/);
    assert.equal(alphaHunks[0].fileHeader.includes('src/beta.ts'), false);
    assert.equal(betaHunks[0].fileHeader.includes('src/beta.ts'), true);
});
