import type { TreeNode } from './BasicTreeView';

export const TREE_ROW_HEIGHT = 22;
const ROW_HEIGHT = TREE_ROW_HEIGHT;
const MAX_STICKY_ROWS = 7;
const MAX_STICKY_VIEWPORT_RATIO = 0.4;

export interface FlatTreeNode<T> {
    node: TreeNode<T>;
    depth: number;
    ancestorIds: string[];
}

export interface StickyHeaderState<T> {
    item: FlatTreeNode<T>;
    offset: number;
}

export function getStickyHeaderStates<T>(
    flatNodes: FlatTreeNode<T>[],
    flatNodeIndexById: Map<string, number>,
    visibleTop: number,
    stickyHeaders: boolean,
    viewportHeight: number,
    isStickyHeader?: (node: TreeNode<T>) => boolean
): StickyHeaderState<T>[] {
    const maxStickyRows = Math.min(
        MAX_STICKY_ROWS,
        Math.floor((viewportHeight * MAX_STICKY_VIEWPORT_RATIO) / ROW_HEIGHT)
    );
    if (!stickyHeaders || maxStickyRows < 1 || visibleTop <= 0 || visibleTop >= flatNodes.length * ROW_HEIGHT) {
        return [];
    }

    const canStick = (node: TreeNode<T>) => {
        if (!node.children || node.children.length === 0) {
            return false;
        }
        return isStickyHeader ? isStickyHeader(node) : true;
    };

    const getStickyDepth = (item: FlatTreeNode<T>) => {
        let depth = 0;
        for (const ancId of item.ancestorIds) {
            const ancIndex = flatNodeIndexById.get(ancId);
            if (ancIndex !== undefined && canStick(flatNodes[ancIndex].node)) {
                depth++;
            }
        }
        return depth;
    };

    const topIndex = Math.min(flatNodes.length - 1, Math.max(0, Math.floor(visibleTop / ROW_HEIGHT)));

    let lastActiveIndex = topIndex;
    while (lastActiveIndex + 1 < flatNodes.length) {
        const nextNode = flatNodes[lastActiveIndex + 1];
        const stickyDepth = getStickyDepth(nextNode);
        if (stickyDepth >= maxStickyRows) break;
        const naturalPos = (lastActiveIndex + 1) * ROW_HEIGHT - visibleTop;
        const stickyPos = stickyDepth * ROW_HEIGHT;
        if (naturalPos <= stickyPos) {
            lastActiveIndex++;
        } else {
            break;
        }
    }

    const lastActiveNode = flatNodes[lastActiveIndex];
    if (!lastActiveNode) return [];

    const candidateIds = [
        ...lastActiveNode.ancestorIds,
        ...(canStick(lastActiveNode.node) ? [lastActiveNode.node.id] : []),
    ];

    const result: StickyHeaderState<T>[] = [];

    for (const candidateId of candidateIds) {
        if (result.length >= maxStickyRows) break;
        const candidateIndex = flatNodeIndexById.get(candidateId);
        if (candidateIndex === undefined) {
            continue;
        }
        const candidate = flatNodes[candidateIndex];
        if (!canStick(candidate.node)) {
            continue;
        }

        let termIndex = flatNodes.length;
        for (let i = candidateIndex + 1; i < flatNodes.length; i++) {
            if (flatNodes[i].depth <= candidate.depth) {
                termIndex = i;
                break;
            }
        }

        const stickyDepth = getStickyDepth(candidate);
        const targetOffset = stickyDepth * ROW_HEIGHT;
        const termDist = termIndex * ROW_HEIGHT - visibleTop;
        const offset = Math.min(targetOffset, termDist - ROW_HEIGHT);

        result.push({
            item: candidate,
            offset,
        });
    }

    return result;
}

export function flattenVisibleNodes<T>(
    nodes: TreeNode<T>[],
    expandedIds: Set<string>,
    isDragging = false
): FlatTreeNode<T>[] {
    const result: FlatTreeNode<T>[] = [];
    const stack = nodes.map((node) => ({ node, depth: 0, ancestorIds: [] as string[] })).reverse();

    while (stack.length > 0) {
        const item = stack.pop()!;
        if (item.node.showOnlyOnDrag && !isDragging) continue;
        result.push(item);

        const children = item.node.children;
        if (children && children.length > 0 && expandedIds.has(item.node.id)) {
            for (let i = children.length - 1; i >= 0; i--) {
                stack.push({
                    node: children[i],
                    depth: item.depth + 1,
                    ancestorIds: [...item.ancestorIds, item.node.id],
                });
            }
        }
    }

    return result;
}
