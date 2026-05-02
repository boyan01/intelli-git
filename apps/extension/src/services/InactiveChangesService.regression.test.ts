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
