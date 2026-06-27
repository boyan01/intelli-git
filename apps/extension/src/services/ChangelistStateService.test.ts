import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileStatus, GitHunk } from '@shared/messages';
import { ChangelistStateService } from './ChangelistStateService';
import { __getChangelistMode, __setChangelistMode } from '../test/mocks/vscode';

interface WorkspaceState {
    get<T>(key: string, defaultValue?: T): T | undefined;
    update(key: string, value: unknown): Promise<void>;
}

function createWorkspaceState(initial: Record<string, unknown> = {}): WorkspaceState & { values: Record<string, unknown> } {
    const values = { ...initial };
    return {
        values,
        get<T>(key: string, defaultValue?: T): T | undefined {
            return Object.prototype.hasOwnProperty.call(values, key)
                ? values[key] as T | undefined
                : defaultValue;
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

function createServiceWithWorkspaceState(initial: Record<string, unknown> = {}) {
    const workspaceState = createWorkspaceState(initial);
    return {
        workspaceState,
        service: new ChangelistStateService({ workspaceState } as never)
    };
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
                    isDefault: false,
                    isActive: true
                },
                {
                    id: 'changes',
                    name: 'Changes',
                    isDefault: true,
                    isActive: false
                },
                {
                    id: 'inactive-changes',
                    name: 'Inactive Changes',
                    isDefault: true,
                    isActive: false
                }
            ],
            assignments: {
                'src/kept.ts': { fileListId: 'review' },
                'src/hunks.ts': { hunkListIds: { keep: 'review' } }
            }
        });
    });

    it('stores mode in extension workspace state instead of workspace settings', async () => {
        __setChangelistMode('staged');
        const { service, workspaceState } = createServiceWithWorkspaceState();

        await service.setMode('changes');

        expect(service.getState().mode).toBe('changes');
        expect(workspaceState.values['ideaCommitPanel.changelistMode.v1']).toBe('changes');
        expect(__getChangelistMode()).toBe('staged');
    });

    it('does not copy global changelist state into repo-specific state by default', () => {
        const workspaceState = createWorkspaceState({
            'ideaCommitPanel.changelists.v1': {
                lists: [
                    { id: 'changes', name: 'Changes' },
                    { id: 'review', name: 'Review' }
                ],
                activeListId: 'review',
                assignments: {
                    'README.md': { fileListId: 'review' }
                }
            }
        });

        const service = new ChangelistStateService({ workspaceState } as never, '/workspace/second');

        expect(service.getState()).toMatchObject({
            activeListId: 'changes',
            assignments: {}
        });
    });

    it('migrates global changelist state only when explicitly requested', () => {
        const workspaceState = createWorkspaceState({
            'ideaCommitPanel.changelists.v1': {
                lists: [
                    { id: 'changes', name: 'Changes' },
                    { id: 'review', name: 'Review' }
                ],
                activeListId: 'review',
                assignments: {
                    'README.md': { fileListId: 'review' }
                }
            }
        });

        const service = new ChangelistStateService({ workspaceState } as never, '/workspace/first', true);

        expect(service.getState()).toMatchObject({
            activeListId: 'review',
            assignments: {
                'README.md': { fileListId: 'review' }
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
                },
                {
                    id: 'inactive-changes',
                    isActive: false
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

    it('preserves whole-file changelist assignments when tracked files gain hunks', async () => {
        const service = createService();
        const review = await service.createList('Review');
        await service.moveFiles(['src/added.ts'], review.id);

        service.syncWithStatus([
            {
                path: 'src/added.ts',
                status: 'A',
                staged: true,
                hunks: [hunk('src/added.ts:index:0:0:1:1:added')]
            }
        ]);

        expect(service.getState().assignments).toEqual({
            'src/added.ts': {
                hunkListIds: {
                    'src/added.ts:index:0:0:1:1:added': review.id
                }
            }
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

    it('builds a commit plan for a non-active changelist without changing the active list', async () => {
        const service = createService();
        const review = await service.createList('Review');
        await service.moveHunks('src/file.ts', ['h2'], review.id);
        await service.moveFiles(['src/review-only.ts'], review.id);

        const plan = service.buildCommitPlan([
            status('src/file.ts', [hunk('h1'), hunk('h2')]),
            status('src/review-only.ts'),
            status('src/active-only.ts')
        ], undefined, review.id);

        expect(plan).toEqual({
            files: ['src/file.ts', 'src/review-only.ts'],
            excludedFiles: ['src/active-only.ts'],
            excludedHunkIdsByPath: {
                'src/file.ts': ['h1']
            }
        });
        expect(service.getState().activeListId).toBe('changes');
    });

    it('scopes a non-active changelist commit plan to requested files', async () => {
        const service = createService();
        const review = await service.createList('Review');
        await service.moveHunks('src/file.ts', ['h2'], review.id);
        await service.moveFiles(['src/other.ts'], review.id);

        const plan = service.buildCommitPlan([
            status('src/file.ts', [hunk('h1'), hunk('h2')]),
            status('src/other.ts')
        ], ['src/file.ts'], review.id);

        expect(plan).toEqual({
            files: ['src/file.ts'],
            excludedFiles: [],
            excludedHunkIdsByPath: {
                'src/file.ts': ['h1']
            }
        });
    });

    it('includes requested untracked files in the active changelist commit plan', async () => {
        const service = createService();

        const plan = service.buildCommitPlan([
            {
                path: 'src/new.ts',
                status: '?',
                staged: false
            },
            {
                path: 'src/ignored.ts',
                status: '?',
                staged: false
            }
        ], ['src/new.ts']);

        expect(plan).toEqual({
            files: ['src/new.ts'],
            excludedFiles: [],
            excludedHunkIdsByPath: {}
        });
    });

    it('does not reverse-apply hunks for files excluded from the commit plan', async () => {
        const service = createService();
        const review = await service.createList('Review');
        await service.moveHunks('src/deleted.ts', ['delete-hunk'], review.id);

        const plan = service.buildCommitPlan([
            status('src/active.ts', [hunk('active-hunk')]),
            status('src/deleted.ts', [hunk('delete-hunk')])
        ]);

        expect(plan).toEqual({
            files: ['src/active.ts'],
            excludedFiles: ['src/deleted.ts'],
            excludedHunkIdsByPath: {}
        });
    });
});
