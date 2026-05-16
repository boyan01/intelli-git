import { describe, expect, it } from 'vitest';
import type { ChangelistState, FileStatus, GitHunk } from '@shared/messages';
import { buildChangelists, buildSplitInfoByPath, getSelectedFiles, hasTrackedChanges } from './changelistModel';

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
        newLineCount: 1
    };
}

function file(path: string, overrides: Partial<FileStatus> = {}): FileStatus {
    return {
        path,
        status: 'M',
        staged: false,
        ...overrides
    };
}

function changelistState(mode: ChangelistState['mode']): ChangelistState {
    return {
        mode,
        activeListId: 'changes',
        lists: [
            { id: 'changes', name: 'Changes', isDefault: true, isActive: true },
            { id: 'review', name: 'Review', isDefault: false, isActive: false },
            { id: 'inactive-changes', name: 'Inactive Changes', isDefault: true, isActive: false }
        ],
        assignments: {}
    };
}

describe('changelistModel', () => {
    it('keeps staged mode split into staged, changes, untracked, and inactive groups', () => {
        const inactive = hunk('src/partial.ts:worktree:inactive');
        const active = hunk('src/partial.ts:worktree:active');
        const groups = buildChangelists([
            file('src/staged.ts', { staged: true }),
            file('src/worktree.ts'),
            file('src/new.ts', { status: '?' }),
            file('src/inactive.ts', { inactive: true }),
            file('src/partial.ts', {
                hunks: [active, inactive],
                inactiveHunkIds: [inactive.id],
                hasStagedInactive: true
            })
        ], changelistState('staged'), t);

        expect(groups.map(group => [group.id, group.items.map(item => item.path)])).toEqual([
            ['staged-changes', ['src/staged.ts']],
            ['changes', ['src/worktree.ts', 'src/partial.ts']],
            ['untracked-changes', ['src/new.ts']],
            ['inactive-changes', ['src/inactive.ts', 'src/partial.ts']]
        ]);
        expect(groups.find(group => group.id === 'changes')?.items.find(item => item.path === 'src/partial.ts')?.hunks).toEqual([active]);
        expect(groups.find(group => group.id === 'inactive-changes')?.hasWarning).toBe(true);
    });

    it('uses active changelist files plus untracked files as the changes mode commit selection', () => {
        const state = changelistState('changes');
        state.assignments = {
            'src/review.ts': { fileListId: 'review' }
        };

        const groups = buildChangelists([
            file('src/active.ts'),
            file('src/review.ts'),
            file('src/new.ts', { status: '?' })
        ], state, t);

        expect(groups.find(group => group.id === 'changes')?.items.map(item => item.path)).toEqual(['src/active.ts']);
        expect(groups.find(group => group.id === 'review')?.items.map(item => item.path)).toEqual(['src/review.ts']);
        expect(Array.from(getSelectedFiles([], groups, state)).sort()).toEqual(['src/active.ts', 'src/new.ts']);
    });

    it('splits assigned and inactive hunks without exposing hunk child nodes to callers', () => {
        const state = changelistState('changes');
        state.assignments = {
            'src/split.ts': {
                hunkListIds: {
                    'src/split.ts:worktree:review': 'review'
                }
            }
        };
        const active = hunk('src/split.ts:worktree:active');
        const review = hunk('src/split.ts:worktree:review');
        const inactive = hunk('src/split.ts:worktree:inactive');

        const groups = buildChangelists([
            file('src/split.ts', {
                hunks: [active, review, inactive],
                inactiveHunkIds: [inactive.id]
            })
        ], state, t);

        expect(groups.find(group => group.id === 'changes')?.items).toMatchObject([
            { path: 'src/split.ts', hunks: [active] }
        ]);
        expect(groups.find(group => group.id === 'review')?.items).toMatchObject([
            { path: 'src/split.ts', hunks: [review] }
        ]);
        expect(groups.find(group => group.id === 'inactive-changes')?.items).toMatchObject([
            { path: 'src/split.ts', hunks: [inactive], inactive: true }
        ]);
    });

    it('marks files shown in multiple groups as split', () => {
        const splitInfo = buildSplitInfoByPath([
            {
                id: 'changes',
                name: 'Changes',
                isDefault: true,
                isActive: true,
                items: [file('src/split.ts'), file('src/only-active.ts')]
            },
            {
                id: 'review',
                name: 'Review',
                isDefault: false,
                isActive: false,
                items: [file('src/split.ts')]
            }
        ]);

        expect(splitInfo.get('src/split.ts')).toEqual({
            groupCount: 2,
            groupNames: ['Changes', 'Review']
        });
        expect(splitInfo.has('src/only-active.ts')).toBe(false);
    });

    it('does not treat inactive, conflict, or untracked entries as tracked changes', () => {
        expect(hasTrackedChanges([
            file('src/new.ts', { status: '?' }),
            file('src/conflict.ts', { status: 'C' }),
            file('src/inactive.ts', { inactive: true })
        ])).toBe(false);

        expect(hasTrackedChanges([
            file('src/modified.ts')
        ])).toBe(true);
    });
});
