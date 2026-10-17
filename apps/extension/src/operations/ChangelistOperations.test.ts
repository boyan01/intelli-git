import { describe, expect, it, vi } from 'vitest';
import type { ChangelistStateService } from '../services/ChangelistStateService';
import type { ReviewedStateService } from '../services/ReviewedStateService';
import { ChangelistOperations } from './ChangelistOperations';

describe('ChangelistOperations', () => {
    it('moves file and hunk changes to a changelist as one workflow', async () => {
        const refreshDecorations = vi.fn().mockResolvedValue(undefined);
        const changelistStateService = {
            moveFiles: vi.fn().mockResolvedValue(undefined),
            moveHunks: vi.fn().mockResolvedValue(undefined),
        } as unknown as ChangelistStateService;

        const operations = new ChangelistOperations({
            changelistStateService,
            refreshDecorations,
        });

        await operations.moveChangesToChangelist({
            targetListId: 'review',
            paths: ['src/a.ts'],
            hunksByPath: {
                'src/b.ts': ['h1', 'h2', 'h1'],
            },
        });

        expect(changelistStateService.moveFiles).toHaveBeenCalledWith(['src/a.ts'], 'review');
        expect(changelistStateService.moveHunks).toHaveBeenCalledWith('src/b.ts', ['h1', 'h2'], 'review');
        expect(refreshDecorations).toHaveBeenCalledOnce();
    });

    it('marks unique files as reviewed and refreshes the commit view', async () => {
        const refreshCommitView = vi.fn();
        const reviewedStateService = {
            setReviewed: vi.fn().mockResolvedValue(undefined),
        } as unknown as ReviewedStateService;

        const operations = new ChangelistOperations({
            changelistStateService: {} as ChangelistStateService,
            reviewedStateService,
            refreshCommitView,
        });

        await operations.setFilesReviewed(['src/a.ts', 'src/a.ts', ''], true);

        expect(reviewedStateService.setReviewed).toHaveBeenCalledWith(['src/a.ts'], true);
        expect(refreshCommitView).toHaveBeenCalledOnce();
    });
});
