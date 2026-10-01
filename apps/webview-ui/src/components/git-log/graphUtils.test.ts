import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LogCommit, RefInfo } from '@shared/messages';
import { computeGraph } from './graphUtils';
import { GraphColumn } from './GraphColumn';

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
        filteredAncestors: [],
    };
}

describe('computeGraph', () => {
    it.each([1, 2])('reuses a vacated outer column without crossing incoming curves (%i side lanes)', (sideLanes) => {
        const commits = [
            makeCommit('source', ['target']),
            ...Array.from({ length: 38 }, (_, index) =>
                makeCommit(`filler-${index}`, [index === 37 ? 'left' : `filler-${index + 1}`])
            ),
            makeCommit('left', ['join']),
            ...Array.from({ length: sideLanes }, (_, index) => makeCommit(`right-${index}`, ['join'])),
            makeCommit('join', ['base']),
            makeCommit('target', ['base']),
            makeCommit('base'),
        ];
        const graph = computeGraph(commits, false);
        const arrow = graph.get('join')!.lines.find((line) => line.arrowDirection === 'up')!;

        expect(graph.get('join')?.lines).toEqual(
            expect.arrayContaining([expect.objectContaining({ x1: sideLanes, y1: 0, x2: 0, y2: 0.5 })])
        );
        expect(arrow).toMatchObject({ x1: sideLanes, x2: sideLanes, y1: 0.3, y2: 1, targetCommitHash: 'source' });
        expect(graph.get('target')?.column).toBe(sideLanes);
        expect(graph.get('target')?.lines).toEqual(
            expect.arrayContaining([expect.objectContaining({ x1: sideLanes, y1: 0, x2: sideLanes, y2: 0.5 })])
        );
    });

    it('bounds folded edges to neighboring rows and keeps arrow stems straight', () => {
        const commits = [
            makeCommit('source', ['target']),
            ...Array.from({ length: 40 }, (_, index) =>
                makeCommit(`side-${index}`, index === 39 ? [] : [`side-${index + 1}`])
            ),
            makeCommit('target'),
        ];
        const graph = computeGraph(commits, false);
        const arrows = commits.flatMap((commit, row) =>
            graph
                .get(commit.hash)!
                .lines.filter((line) => line.isLongDistance)
                .map((line) => ({ row, line }))
        );

        expect(graph.get('side-1')?.column).toBe(0);
        expect(graph.get('side-1')?.color).toBe(graph.get('side-0')?.color);
        expect(graph.get('side-1')?.lines).toEqual(
            expect.arrayContaining([expect.objectContaining({ x1: 1, y1: 0, x2: 0, y2: 0.5 })])
        );
        expect(graph.get('side-38')?.maxX).toBe(0);
        expect(arrows).toHaveLength(2);
        expect(arrows[0]).toEqual({
            row: 1,
            line: expect.objectContaining({
                arrowDirection: 'down',
                targetCommitHash: 'target',
                y1: 0,
                y2: 0.7,
            }),
        });
        expect(arrows[1]).toEqual({
            row: 40,
            line: expect.objectContaining({
                arrowDirection: 'up',
                targetCommitHash: 'source',
                y1: 0.3,
                y2: 1,
            }),
        });
        for (const { row, line } of arrows) {
            expect(line.x1).toBe(line.x2);
            expect(line.x1).not.toBe(graph.get(commits[row].hash)?.column);
        }
    });

    it('reuses the second column as a downward arrow ends before main appears', () => {
        const commits = [
            makeCommit('long-3', ['main-38']),
            makeCommit('long-2', ['main-39']),
            makeCommit('long-1', ['base']),
            ...Array.from({ length: 40 }, (_, index) =>
                makeCommit(
                    `main-${index}`,
                    [index === 39 ? 'base' : `main-${index + 1}`],
                    index === 0 ? [{ name: 'origin/main', type: 'remote' }] : []
                )
            ),
            makeCommit('base', [], [{ name: 'main', type: 'local' }]),
        ];
        const graph = computeGraph(commits, false, { preferDefaultBranchLane: true });
        const source = graph.get('long-1')!;
        const next = graph.get('main-0')!;

        expect(source.column).toBe(0);
        expect(source.maxX).toBe(1);
        expect(source.lines).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ x1: 1, x2: 1, y2: 0.7, arrowDirection: 'down', targetCommitHash: 'main-39' }),
                expect.objectContaining({ x1: 0, y1: 0.5, x2: 1, y2: 1, color: source.color }),
            ])
        );
        expect(next.column).toBe(0);
        expect(next.maxX).toBe(1);
        expect(next.lines).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ x1: 1, x2: 1, y2: 0.7, arrowDirection: 'down', color: source.color }),
            ])
        );
        expect(graph.get('main-1')?.maxX).toBe(0);
    });

    it('compacts three feature commits left and bends only before the main tip', () => {
        const commits = [
            makeCommit('feature-1', ['feature-2']),
            makeCommit('feature-2', ['feature-3']),
            makeCommit('feature-3', ['base']),
            makeCommit('main-tip', ['main-middle'], [{ name: 'origin/main', type: 'remote' }]),
            makeCommit('main-middle', ['base']),
            makeCommit('base', [], [{ name: 'main', type: 'local' }]),
        ];
        const graph = computeGraph(commits, false, { preferDefaultBranchLane: true });

        for (const hash of ['feature-1', 'feature-2', 'feature-3', 'main-tip', 'main-middle', 'base']) {
            expect(graph.get(hash)?.column).toBe(0);
        }
        expect(graph.get('feature-1')?.maxX).toBe(0);
        expect(graph.get('feature-2')?.maxX).toBe(0);
        expect(graph.get('feature-3')?.lines).toEqual(
            expect.arrayContaining([expect.objectContaining({ x1: 0, y1: 0.5, x2: 1, y2: 1 })])
        );
        expect(graph.get('main-tip')?.lines).toEqual(
            expect.arrayContaining([expect.objectContaining({ x1: 1, y1: 0, x2: 1, y2: 1 })])
        );
        expect(graph.get('base')?.lines).toEqual(
            expect.arrayContaining([expect.objectContaining({ x1: 1, y1: 0, x2: 0, y2: 0.5 })])
        );
        expect(graph.get('feature-3')?.color).toBe(graph.get('feature-1')?.color);
    });

    it.each(['main', 'master'])('pins remote %s history when the local branch is behind', (branch) => {
        const graph = computeGraph(
            [
                makeCommit('feature-tip', ['local-main']),
                makeCommit('remote-main', ['remote-middle'], [{ name: `origin/${branch}`, type: 'remote' }]),
                makeCommit('remote-middle', ['local-main']),
                makeCommit('local-main', ['base'], [{ name: branch, type: 'local' }]),
                makeCommit('base'),
            ],
            false,
            { preferDefaultBranchLane: true }
        );

        for (const hash of ['remote-main', 'remote-middle', 'local-main', 'base']) {
            expect(graph.get(hash)?.column).toBe(0);
            expect(graph.get(hash)?.color).toBe(graph.get('local-main')?.color);
        }
        expect(graph.get('feature-tip')?.column).toBe(0);
    });

    it.each([['base'], ['base', 'local-main']])(
        'keeps divergent remote history separate from local main (%j)',
        (...parents) => {
            const graph = computeGraph(
                [
                    makeCommit('remote-main', parents, [{ name: 'origin/main', type: 'remote' }]),
                    makeCommit('local-main', ['base'], [{ name: 'main', type: 'local' }]),
                    makeCommit('base'),
                ],
                false,
                { preferDefaultBranchLane: true }
            );

            expect(graph.get('local-main')?.column).toBe(0);
            expect(graph.get('remote-main')?.column).toBe(0);
            expect(graph.get('remote-main')?.color).not.toBe(graph.get('local-main')?.color);
            expect(graph.get('remote-main')?.lines).toEqual(
                expect.arrayContaining([expect.objectContaining({ x1: 0, y1: 0.5, x2: 1, y2: 1 })])
            );
        }
    );

    it.each([false, true])('preserves row-boundary connections across merges and long edges (pinned=%s)', (pinned) => {
        let seed = 42;
        const random = (limit: number): number => {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            return seed % limit;
        };
        for (let sample = 0; sample < 20; sample++) {
            const commits = Array.from({ length: 80 }, (_, index) => {
                const remaining = 79 - index;
                const parents = remaining === 0 ? [] : [String(index + 1 + random(remaining))];
                if (remaining > 1 && random(3) === 0) {
                    parents.push(String(index + 1 + random(remaining)));
                }
                return makeCommit(
                    String(index),
                    [...new Set(parents)],
                    index === 4 ? [{ name: 'main', type: 'local' }] : []
                );
            });
            const graph = computeGraph(commits, false, { preferDefaultBranchLane: pinned });
            for (let index = 1; index < commits.length; index++) {
                const previous = graph.get(commits[index - 1].hash)!;
                const current = graph.get(commits[index].hash)!;
                const outgoing = previous.lines
                    .filter((line) => line.y2 === 1 && line.arrowDirection !== 'down')
                    .map((line) => `${line.x2}:${line.color}`)
                    .sort();
                const incoming = current.lines
                    .filter((line) => line.y1 === 0 && line.arrowDirection !== 'up')
                    .map((line) => `${line.x1}:${line.color}`)
                    .sort();
                expect([...new Set(incoming)]).toEqual([...new Set(outgoing)]);
                for (const line of current.lines.filter((line) => line.isLongDistance)) {
                    expect(line.x1).toBe(line.x2);
                    expect(line.x1).not.toBe(current.column);
                }
            }
        }
    });

    it('preserves branch color after another lane ends and columns compact', () => {
        const graph = computeGraph(
            [
                makeCommit('left-tip', ['left-root']),
                makeCommit('right-tip', ['right-middle']),
                makeCommit('left-root'),
                makeCommit('right-middle', ['right-root']),
                makeCommit('right-root'),
            ],
            false
        );

        expect(graph.get('right-tip')?.column).toBe(1);
        expect(graph.get('right-middle')?.column).toBe(0);
        expect(graph.get('right-middle')?.color).toBe(graph.get('right-tip')?.color);
        expect(graph.get('right-root')?.color).toBe(graph.get('right-tip')?.color);
    });

    it('keeps a long main connection continuous in the first lane', () => {
        const commits = [
            makeCommit('main-tip', ['base'], [{ name: 'main', type: 'local' }]),
            ...Array.from({ length: 40 }, (_, index) =>
                makeCommit(`feature-${index}`, [index === 39 ? 'base' : `feature-${index + 1}`])
            ),
            makeCommit('base'),
        ];
        const graph = computeGraph(commits, false, { preferDefaultBranchLane: true });

        for (let index = 1; index <= 40; index++) {
            expect(graph.get(commits[index].hash)?.column).toBe(1);
            expect(graph.get(commits[index].hash)?.lines).toEqual(
                expect.arrayContaining([expect.objectContaining({ x1: 0, y1: 0, x2: 0, y2: 1 })])
            );
        }
        expect(graph.get('base')?.column).toBe(0);
        expect(graph.get('base')?.lines.some((line) => line.isLongDistance)).toBe(false);
    });

    it('keeps main left when a feature merges main before its tip is visited', () => {
        const graph = computeGraph(
            [
                makeCommit('feature-merge', ['feature-base', 'main-tip']),
                makeCommit('main-tip', ['base'], [{ name: 'origin/main', type: 'remote' }]),
                makeCommit('feature-base', ['base']),
                makeCommit('base'),
            ],
            false,
            { preferDefaultBranchLane: true }
        );

        expect(graph.get('main-tip')?.column).toBe(0);
        expect(graph.get('feature-base')?.column).toBe(1);
        expect(graph.get('feature-merge')?.lines).toEqual(
            expect.arrayContaining([expect.objectContaining({ x1: 0, y1: 0.5, x2: 0, y2: 1 })])
        );
    });

    it('moves an existing feature aside immediately before main appears', () => {
        const commits = [
            makeCommit('feature-tip', ['feature-base'], [{ name: 'feature/login', type: 'local' }]),
            makeCommit('main-tip', ['base'], [{ name: 'main', type: 'local' }]),
            makeCommit('feature-base', ['base']),
            makeCommit('base'),
        ];

        const graph = computeGraph(commits, false, { preferDefaultBranchLane: true });

        expect(graph.get('feature-tip')?.column).toBe(0);
        expect(graph.get('feature-base')?.column).toBe(1);
        expect(graph.get('main-tip')?.column).toBe(0);
        expect(graph.get('base')?.column).toBe(0);
    });

    it('connects a feature tip to its default-branch parent without a boundary gap', () => {
        const commits = [
            makeCommit('feature-tip', ['main-tip'], [{ name: 'origin/perps/fix_open_order', type: 'remote' }]),
            makeCommit(
                'main-tip',
                ['base'],
                [
                    { name: 'main', type: 'head' },
                    { name: 'origin/main', type: 'remote' },
                    { name: 'origin/HEAD', type: 'remote' },
                ]
            ),
            makeCommit('base'),
        ];

        const graph = computeGraph(commits, false, { preferDefaultBranchLane: true });

        expect(graph.get('feature-tip')?.column).toBe(0);
        expect(graph.get('main-tip')?.column).toBe(0);
        expect(graph.get('main-tip')?.lines).toEqual(
            expect.arrayContaining([expect.objectContaining({ x1: 0, y1: 0, x2: 0, y2: 0.5 })])
        );
    });

    it('keeps a local main commit ahead of origin main on the default branch lane', () => {
        const commits = [
            makeCommit('local-main', ['origin-main'], [{ name: 'main', type: 'head' }]),
            makeCommit(
                'origin-main',
                ['base'],
                [
                    { name: 'origin/main', type: 'remote' },
                    { name: 'origin/HEAD', type: 'remote' },
                ]
            ),
            makeCommit('feature-tip', ['base'], [{ name: 'origin/message-template', type: 'remote' }]),
            makeCommit('base'),
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
            makeCommit('base'),
        ];

        const graph = computeGraph(commits, false);

        expect(graph.get('feature-tip')?.column).toBe(0);
        expect(graph.get('main-tip')?.column).toBe(1);
    });

    it('does not treat slash-suffixed feature branches as the default branch', () => {
        const commits = [
            makeCommit('topic-tip', ['base'], [{ name: 'topic', type: 'local' }]),
            makeCommit('feature-main-tip', ['base'], [{ name: 'feature/main', type: 'remote' }]),
            makeCommit('base'),
        ];

        const graph = computeGraph(commits, false, { preferDefaultBranchLane: true });

        expect(graph.get('topic-tip')?.column).toBe(0);
        expect(graph.get('feature-main-tip')?.column).toBe(1);
    });
});

describe('GraphColumn arrows', () => {
    it.each(['up', 'down'] as const)('aligns the %s hit area with a sharp head above other lines', (direction) => {
        const markup = renderToStaticMarkup(
            createElement(GraphColumn, {
                node: {
                    column: 1,
                    color: '#81c784',
                    isMerge: false,
                    maxX: 1,
                    lines: [
                        {
                            x1: 0,
                            y1: direction === 'up' ? 0.3 : 0,
                            x2: 0,
                            y2: direction === 'up' ? 1 : 0.7,
                            color: '#81c784',
                            isMerge: false,
                            isLongDistance: true,
                            targetCommitHash: 'target',
                            arrowDirection: direction,
                        },
                        { x1: 1, y1: 0, x2: 0, y2: 1, color: '#4fc3f7', isMerge: true },
                    ],
                },
                rowHeight: 24,
                graphWidth: 32,
                rowIndex: 0,
            })
        );
        const firstPath = markup.match(/<path[^>]* d="([^"]+)"/)![1];
        const arrowGroup = markup.match(/<g[^>]*data-arrow-target="target"[^>]*>(.*?)<\/g>/)![1];
        const hitArea = arrowGroup.match(/<rect[^>]+>/)![0];
        const attribute = (name: string): number => Number(hitArea.match(new RegExp(`${name}="([^"]+)"`))![1]);
        const head = arrowGroup.match(/<path[^>]+>/)![0];

        expect(firstPath).toBe(direction === 'up' ? 'M 8 13.2 L 8 24' : `M 8 0 L 8 ${24 * 0.7 - 6}`);
        expect(attribute('x')).toBe(0);
        expect(attribute('width')).toBe(16);
        expect(attribute('y')).toBeCloseTo(direction === 'up' ? 3.2 : 6.8);
        expect(attribute('height')).toBeCloseTo(direction === 'up' ? 14 : 10);
        expect(head).toContain('stroke="none"');
        expect(head).toContain('pointer-events="none"');
        expect(markup.indexOf('data-arrow-target=')).toBeGreaterThan(markup.indexOf('<circle'));
    });
});
