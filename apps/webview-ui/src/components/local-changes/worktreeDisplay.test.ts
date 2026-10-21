import { describe, expect, it } from 'vitest';
import type { WorktreeInfo } from '@shared/messages';
import { sortWorktrees, splitFolderPath } from './worktreeDisplay';

function worktree(overrides: Partial<WorktreeInfo> & Pick<WorktreeInfo, 'path'>): WorktreeInfo {
    return {
        displayPath: overrides.path,
        isMain: false,
        isCurrent: false,
        isActiveRepository: false,
        pathExists: true,
        isPrunable: false,
        isDirty: false,
        ...overrides,
    };
}

describe('splitFolderPath', () => {
    it('separates the folder name from its parent path', () => {
        expect(splitFolderPath('~/.codex/worktrees/6e89/flutter-app')).toEqual({
            parent: '~/.codex/worktrees/6e89/',
            folder: 'flutter-app',
        });
    });

    it('handles Windows separators and trailing separators', () => {
        expect(splitFolderPath('C:\\work\\app\\')).toEqual({ parent: 'C:\\work\\', folder: 'app' });
    });

    it('returns the whole value as the folder when there is no parent', () => {
        expect(splitFolderPath('app')).toEqual({ parent: '', folder: 'app' });
    });
});

describe('sortWorktrees', () => {
    it('puts the main worktree first, linked worktrees by branch, and missing worktrees last', () => {
        const sorted = sortWorktrees([
            worktree({ path: '/a', branch: 'zeta' }),
            worktree({ path: '/b', branch: 'alpha', pathExists: false }),
            worktree({ path: '/c', branch: 'main', isMain: true }),
            worktree({ path: '/d', branch: 'beta' }),
        ]);

        expect(sorted.map((item) => item.branch)).toEqual(['main', 'beta', 'zeta', 'alpha']);
    });
});
