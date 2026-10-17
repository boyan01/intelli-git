import { describe, expect, it } from 'vitest';
import type { ChangelistState, FileStatus, GitHunk, RepositoryCommitViewState } from '@shared/messages';
import {
    buildChangelists,
    buildSplitInfoByPath,
    buildWorkspaceChangelists,
    getSelectedFiles,
    getWorkspaceSelectedFiles,
    hasTrackedChanges,
} from './changelistModel';

const t = (key: string) => key;

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

function file(path: string, overrides: Partial<FileStatus> = {}): FileStatus {
    return {
        path,
        status: 'M',
        staged: false,
        ...overrides,
    };
}

function changelistState(mode: ChangelistState['mode']): ChangelistState {
    return {
        mode,
        activeListId: 'changes',
        lists: [
            { id: 'changes', name: 'Changes', isDefault: true, isActive: true },
            { id: 'review', name: 'Review', isDefault: false, isActive: false },
        ],
        assignments: {},
    };
}

describe('changelistModel', () => {
    it('keeps staged mode split into staged and changes groups with new files under changes', () => {
        const groups = buildChangelists(
            [
                file('src/conflict.ts', { status: 'C', staged: true }),
                file('src/staged.ts', { staged: true }),
                file('src/worktree.ts'),
                file('src/new.ts', { status: '?', reviewed: true }),
            ],
            changelistState('staged'),
            t
        );

        expect(groups.map((group) => [group.id, group.items.map((item) => item.path)])).toEqual([
            ['conflicting-changes', ['src/conflict.ts']],
            ['staged-changes', ['src/staged.ts']],
            ['changes', ['src/worktree.ts', 'src/new.ts']],
        ]);
        expect(groups[2].items[1].reviewed).toBe(true);
        expect(
            Array.from(getSelectedFiles([file('src/staged.ts', { staged: true })], groups, changelistState('staged')))
        ).toEqual(['src/staged.ts']);
    });

    it('keeps conflicts out of changes mode changelists and commit selection', () => {
        const state = changelistState('changes');
        const groups = buildChangelists(
            [file('src/conflict.ts', { status: 'C', staged: true }), file('src/active.ts')],
            state,
            t
        );

        expect(groups.map((group) => [group.id, group.items.map((item) => item.path)])).toEqual([
            ['conflicting-changes', ['src/conflict.ts']],
            ['changes', ['src/active.ts']],
            ['review', []],
        ]);
        expect(Array.from(getSelectedFiles([], groups, state))).toEqual(['src/active.ts']);
    });

    it('shows new files inside their changelist and selects only the active changelist', () => {
        const state = changelistState('changes');
        state.assignments = {
            'src/review.ts': { fileListId: 'review' },
            'src/later.ts': { fileListId: 'review' },
        };

        const groups = buildChangelists(
            [
                file('src/active.ts'),
                file('src/review.ts'),
                file('src/new.ts', { status: '?' }),
                file('src/later.ts', { status: '?' }),
            ],
            state,
            t
        );

        expect(groups.map((group) => group.id)).toEqual(['changes', 'review']);
        expect(groups.find((group) => group.id === 'changes')?.items.map((item) => item.path)).toEqual([
            'src/active.ts',
            'src/new.ts',
        ]);
        expect(groups.find((group) => group.id === 'review')?.items.map((item) => item.path)).toEqual([
            'src/review.ts',
            'src/later.ts',
        ]);
        expect(Array.from(getSelectedFiles([], groups, state)).sort()).toEqual(['src/active.ts', 'src/new.ts']);
    });

    it('splits assigned hunks without exposing hunk child nodes to callers', () => {
        const state = changelistState('changes');
        state.assignments = {
            'src/split.ts': {
                hunkListIds: {
                    'src/split.ts:head:review': 'review',
                },
            },
        };
        const active = hunk('src/split.ts:head:active');
        const review = hunk('src/split.ts:head:review');

        const groups = buildChangelists(
            [file('src/split.ts', { staged: true, hunks: [active, review] }), file('src/split.ts')],
            state,
            t
        );

        expect(groups.find((group) => group.id === 'changes')?.items).toMatchObject([
            { path: 'src/split.ts', hunks: [active] },
        ]);
        expect(groups.find((group) => group.id === 'review')?.items).toMatchObject([
            { path: 'src/split.ts', hunks: [review] },
        ]);
    });

    it('marks files shown in multiple groups as split', () => {
        const splitInfo = buildSplitInfoByPath([
            {
                id: 'changes',
                name: 'Changes',
                isDefault: true,
                isActive: true,
                items: [file('src/split.ts'), file('src/only-active.ts')],
            },
            {
                id: 'review',
                name: 'Review',
                isDefault: false,
                isActive: false,
                items: [file('src/split.ts')],
            },
        ]);

        expect(splitInfo.get('src/split.ts')).toEqual({
            groupCount: 2,
            groupNames: ['Changes', 'Review'],
        });
        expect(splitInfo.has('src/only-active.ts')).toBe(false);
    });

    it('does not treat conflict or untracked entries as tracked changes', () => {
        expect(hasTrackedChanges([file('src/new.ts', { status: '?' }), file('src/conflict.ts', { status: 'C' })])).toBe(
            false
        );

        expect(hasTrackedChanges([file('src/modified.ts')])).toBe(true);
    });

    it('groups workspace changes by changelist and repository', () => {
        const state = changelistState('staged');
        const repositories: RepositoryCommitViewState[] = [
            {
                repository: {
                    name: 'mixin-route',
                    repoPath: '/workspace/mixin-route',
                    path: '/workspace/mixin-route',
                    workspaceRoot: '/workspace/mixin-route',
                    gitRoot: '/workspace/mixin-route',
                    isSubmodule: false,
                },
                workspaceRoot: '/workspace/mixin-route',
                changelistState: state,
                files: [file('route.go', { staged: true })],
            },
            {
                repository: {
                    name: 'flutter-app',
                    repoPath: '/workspace/flutter-app',
                    path: '/workspace/flutter-app',
                    workspaceRoot: '/workspace/flutter-app',
                    gitRoot: '/workspace/flutter-app',
                    isSubmodule: false,
                },
                workspaceRoot: '/workspace/flutter-app',
                changelistState: state,
                files: [file('lib/main.dart', { staged: true })],
            },
        ];

        const groups = buildWorkspaceChangelists(repositories, t);
        const staged = groups.find((group) => group.id === 'staged-changes');

        expect(
            staged?.repositories.map((repoGroup) => [
                repoGroup.repository.name,
                repoGroup.group.items.map((item) => item.path),
            ])
        ).toEqual([
            ['mixin-route', ['route.go']],
            ['flutter-app', ['lib/main.dart']],
        ]);
        expect(Array.from(getWorkspaceSelectedFiles(groups, state).values())).toEqual([
            { repoPath: '/workspace/mixin-route', path: 'route.go', status: 'M', staged: true },
            { repoPath: '/workspace/flutter-app', path: 'lib/main.dart', status: 'M', staged: true },
        ]);
    });
});
