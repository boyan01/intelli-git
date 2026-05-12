import { describe, expect, it, vi } from 'vitest';
import type { ChangelistStateService } from '../services/ChangelistStateService';
import type { GitService } from '../services/GitService';
import type { InactiveChangesService } from '../services/InactiveChangesService';
import { ChangelistOperations } from './ChangelistOperations';

describe('ChangelistOperations', () => {
    it('keeps inactive files out of the index when marking files inactive', async () => {
        const gitService = {
            getStatus: vi.fn().mockResolvedValue([
                { path: 'src/a.ts', status: 'M', staged: true },
                { path: 'src/b.ts', status: 'M', staged: false }
            ]),
            unstageFiles: vi.fn().mockResolvedValue(undefined)
        } as unknown as GitService;
        const inactiveChangesService = {
            markInactive: vi.fn().mockResolvedValue(undefined)
        } as unknown as InactiveChangesService;

        const operations = new ChangelistOperations({
            gitService,
            inactiveChangesService,
            changelistStateService: {} as ChangelistStateService
        });

        await operations.markFilesInactive(['src/a.ts', 'src/b.ts']);

        expect(inactiveChangesService.markInactive).toHaveBeenCalledWith(['src/a.ts', 'src/b.ts']);
        expect(gitService.unstageFiles).toHaveBeenCalledWith(['src/a.ts']);
    });

    it('moves inactive file and hunk changes to a changelist as one workflow', async () => {
        const refreshDecorations = vi.fn().mockResolvedValue(undefined);
        const inactiveChangesService = {
            markActive: vi.fn().mockResolvedValue(undefined),
            markHunkActive: vi.fn().mockResolvedValue(undefined)
        } as unknown as InactiveChangesService;
        const changelistStateService = {
            moveFiles: vi.fn().mockResolvedValue(undefined),
            moveHunks: vi.fn().mockResolvedValue(undefined)
        } as unknown as ChangelistStateService;

        const operations = new ChangelistOperations({
            gitService: {} as GitService,
            inactiveChangesService,
            changelistStateService,
            refreshDecorations
        });

        await operations.moveChangesToChangelist({
            targetListId: 'review',
            paths: ['src/a.ts'],
            hunksByPath: {
                'src/b.ts': ['h1', 'h2']
            },
            activateInactive: true
        });

        expect(inactiveChangesService.markActive).toHaveBeenCalledWith(['src/a.ts']);
        expect(inactiveChangesService.markHunkActive).toHaveBeenCalledWith('src/b.ts', 'h1');
        expect(inactiveChangesService.markHunkActive).toHaveBeenCalledWith('src/b.ts', 'h2');
        expect(changelistStateService.moveFiles).toHaveBeenCalledWith(['src/a.ts'], 'review');
        expect(changelistStateService.moveHunks).toHaveBeenCalledWith('src/b.ts', ['h1', 'h2'], 'review');
        expect(refreshDecorations).toHaveBeenCalledOnce();
    });
});
