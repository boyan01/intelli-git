import { describe, expect, it } from 'vitest';
import { flattenVisibleNodes, getStickyHeaderStates, type FlatTreeNode } from './treeViewport';

function nestedTree(depth: number): FlatTreeNode<unknown>[] {
    const rows: FlatTreeNode<unknown>[] = [];
    for (let index = 0; index <= depth; index++) {
        rows.push({
            node: {
                id: `${index}`,
                label: `${index}`,
                children: index < depth ? [{ id: `${index + 1}`, label: `${index + 1}` }] : undefined,
            },
            depth: index,
            ancestorIds: Array.from({ length: index }, (_, ancestor) => `${ancestor}`),
        });
    }
    return rows;
}

function sticky(rows: FlatTreeNode<unknown>[], top: number, height: number) {
    return getStickyHeaderStates(rows, new Map(rows.map((row, index) => [row.node.id, index])), top, true, height);
}

describe('tree sticky headers', () => {
    it('limits deep folder chains to seven sticky rows', () => {
        const states = sticky(nestedTree(30), 400, 800);
        expect(states).toHaveLength(7);
        expect(states.map((state) => state.item.node.id)).toEqual(['0', '1', '2', '3', '4', '5', '6']);
    });

    it.each([80, 150, 250, 400])('keeps sticky rows within forty percent of a %ipx viewport', (height) => {
        const states = sticky(nestedTree(30), 400, height);
        expect(states.length * 22).toBeLessThanOrEqual(height * 0.4);
    });

    it('does not create sticky clones before the tree reaches the viewport', () => {
        expect(sticky(nestedTree(10), 0, 400)).toEqual([]);
    });

    it('does not leave sticky clones after the tree leaves the viewport', () => {
        expect(sticky(nestedTree(10), 242, 400)).toEqual([]);
    });

    it('pushes the last sticky row out at the next sibling boundary', () => {
        const rows = nestedTree(3);
        rows.push({ node: { id: 'sibling', label: 'sibling' }, depth: 1, ancestorIds: ['0'] });
        const states = sticky(rows, 55, 400);
        expect(states.find((state) => state.item.node.id === '1')?.offset).toBe(11);
        expect(states.find((state) => state.item.node.id === '2')?.offset).toBe(11);
    });

    it('does not carry sticky directories across functional roots', () => {
        const rows = nestedTree(3);
        rows.push({ node: { id: 'other', label: 'other' }, depth: 0, ancestorIds: [] });
        expect(sticky(rows, 88, 400)).toEqual([]);
    });
});

describe('tree viewport rows', () => {
    const nodes = [
        { id: 'changes', label: 'Changes', children: [{ id: 'file', label: 'file' }] },
        { id: 'inactive', label: 'Inactive', showOnlyOnDrag: true },
    ];
    const expanded = new Set(['changes']);

    it('excludes hidden drop targets from virtualized height and keyboard navigation', () => {
        expect(flattenVisibleNodes(nodes, expanded).map((item) => item.node.id)).toEqual(['changes', 'file']);
    });

    it('includes empty drop targets while dragging and removes them afterward', () => {
        expect(flattenVisibleNodes(nodes, expanded, true).map((item) => item.node.id)).toEqual([
            'changes',
            'file',
            'inactive',
        ]);
        expect(flattenVisibleNodes(nodes, expanded, false)).toHaveLength(2);
    });
});
