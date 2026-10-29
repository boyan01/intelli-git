import { describe, expect, it } from 'vitest';
import { buildRefLabels } from './refLabelModel';

describe('buildRefLabels', () => {
    it('folds same-named remote branches into the local label and hides remote HEAD', () => {
        expect(
            buildRefLabels([
                { name: 'origin/feat/glass', type: 'remote' },
                { name: 'origin/HEAD', type: 'remote' },
                { name: 'feat/glass', type: 'head' },
                { name: 'upstream/feat/glass', type: 'remote' },
            ])
        ).toEqual([{ kind: 'current', name: 'feat/glass', syncedRemotes: ['origin/feat/glass', 'upstream/feat/glass'] }]);
    });

    it('keeps remote-only branches with their remote prefix', () => {
        expect(
            buildRefLabels([
                { name: 'origin/main', type: 'remote' },
                { name: 'origin/HEAD', type: 'remote' },
            ])
        ).toEqual([{ kind: 'remote', name: 'origin/main', syncedRemotes: [] }]);
    });

    it('does not fold a remote branch whose name only shares a suffix', () => {
        expect(
            buildRefLabels([
                { name: 'glass', type: 'local' },
                { name: 'origin/feat/glass', type: 'remote' },
            ])
        ).toEqual([
            { kind: 'local', name: 'glass', syncedRemotes: [] },
            { kind: 'remote', name: 'origin/feat/glass', syncedRemotes: [] },
        ]);
    });

    it('orders current branch, local branches, tags, then remote-only branches', () => {
        const labels = buildRefLabels([
            { name: 'origin/release', type: 'remote' },
            { name: 'v2.4.0', type: 'tag' },
            { name: 'hotfix', type: 'local' },
            { name: 'main', type: 'head' },
            { name: 'release', type: 'local' },
        ]);

        expect(labels.map((label) => `${label.kind}:${label.name}`)).toEqual([
            'current:main',
            'local:hotfix',
            'local:release',
            'tag:v2.4.0',
        ]);
        expect(labels[2].syncedRemotes).toEqual(['origin/release']);
    });

    it('shows a detached HEAD as the current label', () => {
        expect(buildRefLabels([{ name: 'HEAD', type: 'head' }])).toEqual([
            { kind: 'current', name: 'HEAD', syncedRemotes: [] },
        ]);
    });
});
