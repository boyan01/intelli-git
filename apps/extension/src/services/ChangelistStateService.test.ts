import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileStatus, GitHunk } from '@shared/messages';
import { ChangelistStateService } from './ChangelistStateService';
import { __getChangelistMode, __setChangelistMode } from '../test/mocks/vscode';

interface WorkspaceState {
    get<T>(key: string, defaultValue?: T): T | undefined;
    update(key: string, value: unknown): Promise<void>;
}

function createWorkspaceState(
    initial: Record<string, unknown> = {}
): WorkspaceState & { values: Record<string, unknown> } {
    const values = { ...initial };
    return {
        values,
        get<T>(key: string, defaultValue?: T): T | undefined {
            return Object.prototype.hasOwnProperty.call(values, key) ? (values[key] as T | undefined) : defaultValue;
        },
        async update(key: string, value: unknown): Promise<void> {
            values[key] = value;
        },
    };
}

function createService(initial?: unknown): ChangelistStateService {
    const workspaceState = createWorkspaceState(
        initial
            ? {
                  'ideaCommitPanel.changelists.v1': initial,
              }
            : {}
    );

    return new ChangelistStateService({ workspaceState } as never);
}

function createServiceWithWorkspaceState(initial: Record<string, unknown> = {}) {
    const workspaceState = createWorkspaceState(initial);
    return {
        workspaceState,
        service: new ChangelistStateService({ workspaceState } as never),
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
        newLineCount: 1,
    };
}

function status(path: string, hunks: GitHunk[] = []): FileStatus {
    return {
        path,
        status: 'M',
        staged: false,
        hunks,
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
                { id: 'review', name: 'Duplicate' },
            ],
            activeListId: 'missing',
            assignments: {
                'src/kept.ts': { fileListId: 'review' },
                'src/dropped.ts': { fileListId: 'missing' },
                'src/hunks.ts': {
                    hunkListIds: {
                        keep: 'review',
                        drop: 'missing',
                    },
                },
            },
        });

        expect(service.getState()).toEqual({
            mode: 'changes',
            activeListId: 'changes',
            lists: [
                {
                    id: 'changes',
                    name: 'Changes',
                    isDefault: true,
                    isActive: true,
                },
                {
                    id: 'review',
                    name: 'Review',
                    isDefault: false,
                    isActive: false,
                },
            ],
            assignments: {
                'src/kept.ts': { fileListId: 'review' },
                'src/hunks.ts': { hunkListIds: { keep: 'review' } },
            },
        });
    });

    it('migrates legacy inactive changes into an ordinary Inactive Changes changelist', () => {
        const { service, workspaceState } = createServiceWithWorkspaceState({
            'ideaCommitPanel.changelists.v1._repo': {
                lists: [{ id: 'changes', name: 'Changes' }],
                activeListId: 'changes',
                assignments: {},
            },
            'ideaCommitPanel.inactiveChangesV2._repo': {
                files: {
                    'src/whole.ts': { all: true },
                    'src/partial.ts': { hunkIds: ['src/partial.ts:worktree:1:1:1:1:abc'] },
                },
            },
        });
        const repoService = new ChangelistStateService({ workspaceState } as never, '/repo');

        expect(repoService.getState()).toMatchObject({
            activeListId: 'changes',
            lists: [
                { id: 'changes', isDefault: true },
                { id: 'inactive-changes', name: 'Inactive Changes', isDefault: false },
            ],
            assignments: {
                'src/whole.ts': { fileListId: 'inactive-changes' },
                'src/partial.ts': { hunkListIds: { 'src/partial.ts:worktree:1:1:1:1:abc': 'inactive-changes' } },
            },
        });
        expect(workspaceState.values['ideaCommitPanel.inactiveChangesV2._repo']).toBeUndefined();
        expect(service.getState().lists.map((list) => list.id)).toEqual(['changes']);

        // Legacy index/worktree change block ids are remapped onto HEAD-relative ids.
        repoService.syncWithStatus([
            status('src/whole.ts'),
            status('src/partial.ts', [
                { ...hunk('src/partial.ts:head:1:1:1:1:def'), oldStart: 1, newStart: 1 },
                { ...hunk('src/partial.ts:head:40:1:40:1:xyz'), oldStart: 40, newStart: 40 },
            ]),
        ]);
        expect(repoService.getState().assignments['src/partial.ts']).toEqual({
            hunkListIds: {
                'src/partial.ts:head:1:1:1:1:def': 'inactive-changes',
                'src/partial.ts:head:40:1:40:1:xyz': 'changes',
            },
        });
    });

    it('keeps a merged legacy staged and inactive block out of the active changelist', () => {
        const workspaceState = createWorkspaceState({
            'ideaCommitPanel.changelists.v1._repo': {
                lists: [{ id: 'changes', name: 'Changes' }],
                activeListId: 'changes',
                assignments: { 'src/a.ts': { hunkListIds: { 'src/a.ts:index:5:1:5:1:aaa': 'changes' } } },
            },
            'ideaCommitPanel.inactiveChangesV2._repo': {
                files: { 'src/a.ts': { hunkIds: ['src/a.ts:worktree:5:1:5:2:bbb'] } },
            },
        });
        const service = new ChangelistStateService({ workspaceState } as never, '/repo');

        service.syncWithStatus([
            status('src/a.ts', [{ ...hunk('src/a.ts:head:5:1:5:2:ccc'), oldStart: 5, newStart: 5, newLineCount: 2 }]),
        ]);

        expect(service.getState().assignments['src/a.ts']).toEqual({
            hunkListIds: { 'src/a.ts:head:5:1:5:2:ccc': 'inactive-changes' },
        });
        expect(service.buildCommitPlan([status('src/a.ts', [hunk('src/a.ts:head:5:1:5:2:ccc')])]).files).toEqual([]);
    });

    it('keeps the changelist of a renamed file and never moves a split source into the active list', async () => {
        const service = createService();
        const review = await service.createList('Review');
        await service.moveFiles(['src/whole.ts'], review.id);
        await service.moveHunks('src/split.ts', ['h1'], review.id);
        await service.moveHunks('src/split.ts', ['h2'], 'changes');

        service.syncWithStatus([
            { path: 'src/whole-renamed.ts', status: 'R', staged: true, originalPath: 'src/whole.ts' },
            {
                path: 'src/split-renamed.ts',
                status: 'R',
                staged: true,
                originalPath: 'src/split.ts',
                hunks: [hunk('src/split-renamed.ts:head:0:0:1:3:abc')],
            },
        ]);

        expect(service.getState().assignments).toEqual({
            'src/whole-renamed.ts': { fileListId: review.id },
            'src/split-renamed.ts': { hunkListIds: { 'src/split-renamed.ts:head:0:0:1:3:abc': review.id } },
        });
    });

    it('migrates legacy inactive changes even when no changelist state was saved yet', () => {
        const workspaceState = createWorkspaceState({
            'ideaCommitPanel.inactiveChangesV2._repo': { files: { 'src/whole.ts': { all: true } } },
        });
        const service = new ChangelistStateService({ workspaceState } as never, '/repo');

        expect(service.getState().assignments).toEqual({ 'src/whole.ts': { fileListId: 'inactive-changes' } });
        expect(service.getState().lists.map((list) => list.id)).toEqual(['changes', 'inactive-changes']);
    });

    it('drops the reserved Inactive Changes list from older states when nothing uses it', () => {
        const legacyState = (listId: string) => ({
            lists: [
                { id: 'changes', name: 'Changes' },
                { id: 'inactive-changes', name: 'Inactive Changes' },
                { id: 'review', name: 'Review' },
            ],
            activeListId: 'changes',
            assignments: { 'src/a.ts': { fileListId: listId } },
        });
        const listIds = (state: unknown) =>
            createService(state)
                .getState()
                .lists.map((list) => list.id);

        expect(listIds(legacyState('review'))).toEqual(['changes', 'review']);
        expect(listIds(legacyState('inactive-changes'))).toEqual(['changes', 'review', 'inactive-changes']);
    });

    it('lets any changelist except the default one be renamed, deleted, or made active', async () => {
        const service = createService({
            version: 2,
            lists: [
                { id: 'changes', name: 'Changes' },
                { id: 'inactive-changes', name: 'Inactive Changes' },
            ],
            activeListId: 'changes',
            assignments: {},
        });

        await service.setActiveList('inactive-changes');
        expect(service.getState().activeListId).toBe('inactive-changes');
        await service.renameList('inactive-changes', 'Later');
        expect(service.getState().lists.find((list) => list.id === 'inactive-changes')?.name).toBe('Later');
        await service.deleteList('inactive-changes');
        expect(service.getState()).toMatchObject({ activeListId: 'changes', lists: [{ id: 'changes' }] });
        await expect(service.renameList('changes', 'Renamed')).rejects.toThrow();
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
                    { id: 'review', name: 'Review' },
                ],
                activeListId: 'review',
                assignments: {
                    'README.md': { fileListId: 'review' },
                },
            },
        });

        const service = new ChangelistStateService({ workspaceState } as never, '/workspace/second');

        expect(service.getState()).toMatchObject({
            activeListId: 'changes',
            assignments: {},
        });
    });

    it('migrates global changelist state only when explicitly requested', () => {
        const workspaceState = createWorkspaceState({
            'ideaCommitPanel.changelists.v1': {
                lists: [
                    { id: 'changes', name: 'Changes' },
                    { id: 'review', name: 'Review' },
                ],
                activeListId: 'review',
                assignments: {
                    'README.md': { fileListId: 'review' },
                },
            },
        });

        const service = new ChangelistStateService({ workspaceState } as never, '/workspace/first', true);

        expect(service.getState()).toMatchObject({
            activeListId: 'review',
            assignments: {
                'README.md': { fileListId: 'review' },
            },
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
                    isActive: true,
                },
            ],
            assignments: {
                'src/file.ts': { fileListId: 'changes' },
                'src/hunks.ts': { hunkListIds: { h1: 'changes' } },
            },
        });
    });

    it('syncs new tracked and untracked files to the active changelist and drops stale assignments', async () => {
        const service = createService();
        const review = await service.createList('Review');
        await service.setActiveList(review.id);
        await service.moveFiles(['src/stale.ts', 'src/untracked.ts'], 'changes');

        service.syncWithStatus([
            status('src/tracked.ts'),
            {
                path: 'src/untracked.ts',
                status: '?',
                staged: false,
            },
            {
                path: 'src/new.ts',
                status: '?',
                staged: false,
            },
            {
                path: 'src/conflict.ts',
                status: 'C',
                staged: true,
            },
        ]);

        expect(service.getState().assignments).toEqual({
            'src/untracked.ts': { fileListId: 'changes' },
            'src/tracked.ts': { fileListId: review.id },
            'src/new.ts': { fileListId: review.id },
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
                hunks: [hunk('src/added.ts:index:0:0:1:1:added')],
            },
        ]);

        expect(service.getState().assignments).toEqual({
            'src/added.ts': {
                hunkListIds: {
                    'src/added.ts:index:0:0:1:1:added': review.id,
                },
            },
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
                path: 'src/untracked.ts',
                status: '?',
                staged: false,
            },
            {
                path: 'src/conflict.ts',
                status: 'C',
                staged: true,
            },
        ]);

        expect(plan).toEqual({
            files: ['src/file.ts', 'src/other.ts', 'src/untracked.ts'],
            excludedFiles: ['src/conflict.ts'],
            excludedHunkIdsByPath: {
                'src/file.ts': ['h2'],
            },
        });
    });

    it('builds a commit plan for a non-active changelist without changing the active list', async () => {
        const service = createService();
        const review = await service.createList('Review');
        await service.moveHunks('src/file.ts', ['h2'], review.id);
        await service.moveFiles(['src/review-only.ts'], review.id);

        const plan = service.buildCommitPlan(
            [
                status('src/file.ts', [hunk('h1'), hunk('h2')]),
                status('src/review-only.ts'),
                status('src/active-only.ts'),
            ],
            undefined,
            review.id
        );

        expect(plan).toEqual({
            files: ['src/file.ts', 'src/review-only.ts'],
            excludedFiles: ['src/active-only.ts'],
            excludedHunkIdsByPath: {
                'src/file.ts': ['h1'],
            },
        });
        expect(service.getState().activeListId).toBe('changes');
    });

    it('scopes a non-active changelist commit plan to requested files', async () => {
        const service = createService();
        const review = await service.createList('Review');
        await service.moveHunks('src/file.ts', ['h2'], review.id);
        await service.moveFiles(['src/other.ts'], review.id);

        const plan = service.buildCommitPlan(
            [status('src/file.ts', [hunk('h1'), hunk('h2')]), status('src/other.ts')],
            ['src/file.ts'],
            review.id
        );

        expect(plan).toEqual({
            files: ['src/file.ts'],
            excludedFiles: [],
            excludedHunkIdsByPath: {
                'src/file.ts': ['h1'],
            },
        });
    });

    it('includes requested untracked files in the active changelist commit plan', async () => {
        const service = createService();

        const plan = service.buildCommitPlan(
            [
                {
                    path: 'src/new.ts',
                    status: '?',
                    staged: false,
                },
                {
                    path: 'src/ignored.ts',
                    status: '?',
                    staged: false,
                },
            ],
            ['src/new.ts']
        );

        expect(plan).toEqual({
            files: ['src/new.ts'],
            excludedFiles: [],
            excludedHunkIdsByPath: {},
        });
    });

    it('does not reverse-apply hunks for files excluded from the commit plan', async () => {
        const service = createService();
        const review = await service.createList('Review');
        await service.moveHunks('src/deleted.ts', ['delete-hunk'], review.id);

        const plan = service.buildCommitPlan([
            status('src/active.ts', [hunk('active-hunk')]),
            status('src/deleted.ts', [hunk('delete-hunk')]),
        ]);

        expect(plan).toEqual({
            files: ['src/active.ts'],
            excludedFiles: ['src/deleted.ts'],
            excludedHunkIdsByPath: {},
        });
    });
});
