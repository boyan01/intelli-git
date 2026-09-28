import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { createExtensionContext } from '../testSupport/vscodeMock';
import { createHunk } from '../testSupport/hunks';
import { InactiveChangesService } from './InactiveChangesService';

test('InactiveChangesService remaps inactive hunk ids when hunk content changes but position remains nearby', async () => {
    const context = createExtensionContext();
    const service = new InactiveChangesService(context as never);
    const path = 'src/example.ts';
    const oldHunk = createHunk(`${path}:index:30:4:32:5:oldhash`, 30, 32, 4, 5);
    const remappedHunk = createHunk(`${path}:index:31:4:33:5:newhash`, 31, 33, 4, 5);
    const otherHunk = createHunk(`${path}:worktree:31:4:33:5:otherside`, 31, 33, 4, 5);

    await service.markHunkInactive(path, oldHunk.id);

    service.syncWithStatus([{ path, status: 'M', staged: true, hunks: [remappedHunk, otherHunk] }]);

    assert.deepEqual(service.getInactiveHunkIds(path), [remappedHunk.id]);
});

test('InactiveChangesService marks stale matching hunk ids active', async () => {
    const context = createExtensionContext();
    const service = new InactiveChangesService(context as never);
    const path = 'docs/shared.txt';
    const staleHunk = createHunk(`${path}:worktree:2:0:4:1:oldhash`, 2, 4, 0, 1);
    const currentHunk = createHunk(`${path}:worktree:2:0:4:1:newhash`, 2, 4, 0, 1);
    const otherHunk = createHunk(`${path}:worktree:8:0:10:1:other`, 8, 10, 0, 1);

    await service.markHunkInactive(path, staleHunk.id);
    await service.markMatchingHunkActive(path, currentHunk.id, [currentHunk, otherHunk]);

    assert.deepEqual(service.getInactiveHunkIds(path), []);
});

test('InactiveChangesService converts whole-file inactive state when one hunk moves active', async () => {
    const context = createExtensionContext();
    const service = new InactiveChangesService(context as never);
    const path = 'src/staged.txt';
    const activeHunk = createHunk(`${path}:worktree:1:1:1:1:active`, 1, 1, 1, 1);
    const inactiveHunk = createHunk(`${path}:worktree:5:1:5:1:inactive`, 5, 5, 1, 1);

    await service.markInactive([path]);
    await service.markMatchingHunkActive(path, activeHunk.id, [activeHunk, inactiveHunk]);

    assert.equal(service.isInactive(path), false);
    assert.deepEqual(service.getInactiveHunkIds(path), [inactiveHunk.id]);
});

test('InactiveChangesService clears whole-file inactive state when its only hunk moves active', async () => {
    const context = createExtensionContext();
    const service = new InactiveChangesService(context as never);
    const path = 'src/staged.txt';
    const activeHunk = createHunk(`${path}:worktree:1:1:1:1:active`, 1, 1, 1, 1);

    await service.markInactive([path]);
    await service.markMatchingHunkActive(path, activeHunk.id, [activeHunk]);

    assert.equal(service.isInactive(path), false);
    assert.deepEqual(service.getInactiveHunkIds(path), []);
});

test('InactiveChangesService treats inactive untracked directories as inactive child files', async () => {
    const context = createExtensionContext();
    const service = new InactiveChangesService(context as never);

    await service.markInactive(['docs/gdxg/']);

    assert.equal(service.isInactive('docs/gdxg/1241241.dart'), true);

    service.syncWithStatus([
        {
            path: 'docs/gdxg/1241241.dart',
            status: '?',
            staged: false,
            hunks: [createHunk('docs/gdxg/1241241.dart:worktree:0:0:1:1:new', 0, 1, 0, 1)]
        }
    ]);

    assert.equal(service.isInactive('docs/gdxg/1241241.dart'), true);
    assert.deepEqual(service.getInactiveFiles(), ['docs/gdxg/1241241.dart']);
});

test('InactiveChangesService does not copy global state into repo-specific state by default', async () => {
    const context = createExtensionContext();
    await context.workspaceState.update('ideaCommitPanel.inactiveChangesV2', {
        files: {
            'README.md': { all: true }
        }
    });

    const service = new InactiveChangesService(context as never, '/workspace/second');

    assert.equal(service.isInactive('README.md'), false);
});

test('InactiveChangesService migrates global state only when explicitly requested', async () => {
    const context = createExtensionContext();
    await context.workspaceState.update('ideaCommitPanel.inactiveChangesV2', {
        files: {
            'README.md': { all: true }
        }
    });

    const service = new InactiveChangesService(context as never, '/workspace/first', true);

    assert.equal(service.isInactive('README.md'), true);
});

test('InactiveChangesService preserves legacy untracked hunk assignments without loading content', async () => {
    const context = createExtensionContext();
    const service = new InactiveChangesService(context as never);
    const filePath = 'new.txt';
    const hunk = createHunk(`${filePath}:worktree:0:0:1:2:oldhash`, 0, 1, 0, 2);
    await service.markHunkInactive(filePath, hunk.id);
    service.syncWithStatus([{ path: filePath, status: '?', staged: false }]);
    assert.equal(service.isInactive(filePath), true);
    const reopened = new InactiveChangesService(context as never);
    assert.equal(reopened.isInactive(filePath), true);
    await service.markMatchingHunkActive(filePath, hunk.id, [hunk]);
    assert.equal(service.isInactive(filePath), false);
});
