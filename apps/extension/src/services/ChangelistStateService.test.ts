import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileStatus, GitHunk } from '@shared/messages';
import { ChangelistStateService } from './ChangelistStateService';
import { __setChangelistMode } from '../test/mocks/vscode';

interface WorkspaceState {
    get<T>(key: string): T | undefined;
    update(key: string, value: unknown): Promise<void>;
}

function createWorkspaceState(initial: Record<string, unknown> = {}): WorkspaceState & { values: Record<string, unknown> } {
    const values = { ...initial };
    return {
        values,
        get<T>(key: string): T | undefined {
            return values[key] as T | undefined;
        },
        async update(key: string, value: unknown): Promise<void> {
            values[key] = value;
        }
    };
}

function createService(initial?: unknown): ChangelistStateService {
    const workspaceState = createWorkspaceState(initial ? {
        'ideaCommitPanel.changelists.v1': initial
    } : {});

    return new ChangelistStateService({ workspaceState } as never);
}

function hunk(id: string): GitHunk {
    return {
        id,
        lineRange: 'L1-1 / L1-1',
        fileHeader: 'diff --git a/file.ts b/file.ts',
        content: '@@ -1 +1 @@',
        oldStart: 1,
        oldLineCount: 1,
        newStart: 1,
        newLineCount: 1
    };
}

function status(path: string, hunks: GitHunk[] = []): FileStatus {
    return {
        path,
        status: 'M',
        staged: false,
        hunks
    };
}

describe('ChangelistStateService', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-01T00:00:00Z'));
        __setChangelistMode('changes');
    });

    it('normalizes persisted state to one valid active changelist', () => {
        const service = createService({
            lists: [
                { id: '', name: 'Broken' },
                { id: 'review', name: 'Review' },
                { id: 'review', name: 'Duplicate' }
            ],
            activeListId: 'missing',
            assignments: {
                'src/kept.ts': { fileListId: 'review' },
                'src/dropped.ts': { fileListId: 'missing' },
                'src/hunks.ts': {
                    hunkListIds: {
                        keep: 'review',
                        drop: 'missing'
                    }
                }
            }
        });

        expect(service.getState()).toEqual({
            mode: 'changes',
            activeListId: 'review',
            lists: [
                {
                    id: 'review',
                    name: 'Review',
                    isDefault: true,
                    isActive: true
                }
            ],
            assignments: {
                'src/kept.ts': { fileListId: 'review' },
                'src/hunks.ts': { hunkListIds: { keep: 'review' } }
            }
        });
    });

    it('moves deleted changelist assignments to the remaining list and keeps one active list', async () => {
        const service = createService();
        const review = await service.createList('Review');
        await service.setActiveList(review.id);
        await service.moveFiles(['src/file.ts'], review.id);
        await service.moveHunks('src/hunks.ts', ['h1'], review.id);

        await service.deleteList(review.id);

        expect(service.getState()).toMatchObject({
            activeListId: 'changes',
            lists: [
                {
                    id: 'changes',
                    isActive: true
                }
            ],
            assignments: {
                'src/file.ts': { fileListId: 'changes' },
                'src/hunks.ts': { hunkListIds: { h1: 'changes' } }
            }
        });
    });

    it('syncs tracked files to the active changelist and drops stale or untracked assignments', async () => {
        const service = createService();
        const review = await service.createList('Review');
        await service.setActiveList(review.id);
        await service.moveFiles(['src/stale.ts', 'src/untracked.ts'], 'changes');

        service.syncWithStatus([
            status('src/tracked.ts'),
            {
                path: 'src/untracked.ts',
                status: '?',
                staged: false
            }
        ]);

        expect(service.getState().assignments).toEqual({
            'src/untracked.ts': { fileListId: 'changes' },
            'src/tracked.ts': { fileListId: review.id }
        });
    });

    it('builds a commit plan that includes only active changelist hunks', async () => {
        const service = createService();
        const review = await service.createList('Review');
        await service.moveHunks('src/file.ts', ['h2'], review.id);

        const plan = service.buildCommitPlan([
            status('src/file.ts', [hunk('h1'), hunk('h2')]),
            status('src/other.ts'),
            {
                path: 'src/inactive.ts',
                status: 'M',
                staged: false,
                inactive: true
            },
            {
                path: 'src/untracked.ts',
                status: '?',
                staged: false
            }
        ]);

        expect(plan).toEqual({
            files: ['src/file.ts', 'src/other.ts'],
            excludedFiles: ['src/inactive.ts'],
            excludedHunkIdsByPath: {
                'src/file.ts': ['h2']
            }
        });
    });
});
