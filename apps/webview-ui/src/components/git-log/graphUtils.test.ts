import { describe, expect, it } from 'vitest';
import type { LogCommit, RefInfo } from '@shared/messages';
import { computeGraph } from './graphUtils';

function makeCommit(hash: string, parentHashes: string[] = [], refs: RefInfo[] = []): LogCommit {
    return {
        hash,
        shortHash: hash.slice(0, 7),
        subject: hash,
        authorName: 'Test Author',
        authorEmail: 'test@example.com',
        date: '2026-01-01T00:00:00.000Z',
        body: '',
        files: [],
        stats: { additions: 0, deletions: 0 },
        parentHashes,
        containingBranches: [],
        refs,
        filteredAncestors: []
    };
}

describe('computeGraph', () => {
    it('does not reserve an empty first lane before the default branch is visible', () => {
        const commits = [
            makeCommit('feature-tip', ['feature-base'], [{ name: 'feature/login', type: 'local' }]),
            makeCommit('main-tip', ['base'], [{ name: 'main', type: 'local' }]),
            makeCommit('feature-base', ['base']),
            makeCommit('base')
        ];

        const graph = computeGraph(commits, false, { preferDefaultBranchLane: true });

        expect(graph.get('feature-tip')?.column).toBe(0);
        expect(graph.get('feature-base')?.column).toBe(0);
        expect(graph.get('main-tip')?.column).toBe(1);
    });

    it('keeps a feature tip and its default-branch parent on the same first lane', () => {
        const commits = [
            makeCommit('feature-tip', ['main-tip'], [{ name: 'origin/perps/fix_open_order', type: 'remote' }]),
            makeCommit('main-tip', ['base'], [
                { name: 'main', type: 'head' },
                { name: 'origin/main', type: 'remote' },
                { name: 'origin/HEAD', type: 'remote' }
            ]),
            makeCommit('base')
        ];

        const graph = computeGraph(commits, false, { preferDefaultBranchLane: true });

        expect(graph.get('feature-tip')?.column).toBe(0);
        expect(graph.get('main-tip')?.column).toBe(0);
    });

    it('keeps a local main commit ahead of origin main on the default branch lane', () => {
        const commits = [
            makeCommit('local-main', ['origin-main'], [{ name: 'main', type: 'head' }]),
            makeCommit('origin-main', ['base'], [
                { name: 'origin/main', type: 'remote' },
                { name: 'origin/HEAD', type: 'remote' }
            ]),
            makeCommit('feature-tip', ['base'], [{ name: 'origin/message-template', type: 'remote' }]),
            makeCommit('base')
        ];

        const graph = computeGraph(commits, false, { preferDefaultBranchLane: true });

        expect(graph.get('local-main')?.column).toBe(0);
        expect(graph.get('origin-main')?.column).toBe(0);
        expect(graph.get('feature-tip')?.column).toBe(1);
    });

    it('uses natural lane assignment when no default branch preference is requested', () => {
        const commits = [
            makeCommit('feature-tip', ['feature-base'], [{ name: 'feature/login', type: 'local' }]),
            makeCommit('main-tip', ['base'], [{ name: 'main', type: 'local' }]),
            makeCommit('feature-base', ['base']),
            makeCommit('base')
        ];

        const graph = computeGraph(commits, false);

        expect(graph.get('feature-tip')?.column).toBe(0);
        expect(graph.get('main-tip')?.column).toBe(1);
    });

    it('does not treat slash-suffixed feature branches as the default branch', () => {
        const commits = [
            makeCommit('topic-tip', ['base'], [{ name: 'topic', type: 'local' }]),
            makeCommit('feature-main-tip', ['base'], [{ name: 'feature/main', type: 'remote' }]),
            makeCommit('base')
        ];

        const graph = computeGraph(commits, false, { preferDefaultBranchLane: true });

        expect(graph.get('topic-tip')?.column).toBe(0);
        expect(graph.get('feature-main-tip')?.column).toBe(1);
    });
});
