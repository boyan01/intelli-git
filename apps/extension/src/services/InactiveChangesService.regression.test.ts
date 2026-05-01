import test from 'node:test';
import assert from 'node:assert/strict';
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
