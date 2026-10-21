import { describe, expect, it } from 'vitest';
import type { WorktreeInfo } from '@shared/messages';
import { getShortestUniqueSuffixes, sortWorktrees } from './worktreeDisplay';

function worktree(overrides: Partial<WorktreeInfo> & Pick<WorktreeInfo, 'path'>): WorktreeInfo {
    return {
        isMain: false,
        isCurrent: false,
        isActiveRepository: false,
        pathExists: true,
        isPrunable: false,
        isDirty: false,
        ...overrides,
    };
}

describe('getShortestUniqueSuffixes', () => {
    it('uses the folder name when it is already unique', () => {
        const suffixes = getShortestUniqueSuffixes([
            '/Users/me/workspace/mixin/flutter-app',
            '/Users/me/workspace/mixin/flutter-app-ci',
        ]);

        expect(suffixes.get('/Users/me/workspace/mixin/flutter-app')).toBe('flutter-app');
        expect(suffixes.get('/Users/me/workspace/mixin/flutter-app-ci')).toBe('flutter-app-ci');
    });

    it('adds parent segments only for colliding folder names', () => {
        const suffixes = getShortestUniqueSuffixes([
            '/Users/me/workspace/mixin/flutter-app',
            '/Users/me/.codex/worktrees/6e89/flutter-app',
            '/Users/me/.codex/worktrees/a1b2/flutter-app',
            '/Users/me/worktrees/search',
        ]);

        expect(suffixes.get('/Users/me/workspace/mixin/flutter-app')).toBe('mixin/flutter-app');
        expect(suffixes.get('/Users/me/.codex/worktrees/6e89/flutter-app')).toBe('6e89/flutter-app');
        expect(suffixes.get('/Users/me/.codex/worktrees/a1b2/flutter-app')).toBe('a1b2/flutter-app');
        expect(suffixes.get('/Users/me/worktrees/search')).toBe('search');
    });

    it('handles Windows separators', () => {
        const suffixes = getShortestUniqueSuffixes(['C:\\work\\a\\app', 'C:\\work\\b\\app']);

        expect(suffixes.get('C:\\work\\a\\app')).toBe('a/app');
        expect(suffixes.get('C:\\work\\b\\app')).toBe('b/app');
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
