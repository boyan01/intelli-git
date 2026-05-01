import test from 'node:test';
import assert from 'node:assert/strict';
import { createExtensionContext, resetVscodeMock } from '../testSupport/vscodeMock';
import { createHunk } from '../testSupport/hunks';
import { ChangelistStateService } from './ChangelistStateService';

test('ChangelistStateService remaps stale hunk assignments to the nearest current hunk id', async () => {
    resetVscodeMock();
    const context = createExtensionContext();
    const service = new ChangelistStateService(context as never);
    const secondaryList = await service.createList('Secondary');
    const path = 'src/example.ts';
    const oldHunk = createHunk(`${path}:worktree:10:3:10:4:oldhash`, 10, 10, 3, 4);
    const remappedHunk = createHunk(`${path}:worktree:11:3:11:4:newhash`, 11, 11, 3, 4);
    const activeHunk = createHunk(`${path}:worktree:80:2:80:2:activehash`, 80, 80, 2, 2);

    service.syncWithStatus([{ path, status: 'M', staged: false, hunks: [oldHunk] }]);
    await service.moveHunks(path, [oldHunk.id], secondaryList.id);

    service.syncWithStatus([{ path, status: 'M', staged: false, hunks: [remappedHunk, activeHunk] }]);

    const assignment = service.getState().assignments[path];
    assert.equal(assignment.fileListId, undefined);
    assert.deepEqual(assignment.hunkListIds, {
        [remappedHunk.id]: secondaryList.id,
        [activeHunk.id]: 'changes'
    });
});
