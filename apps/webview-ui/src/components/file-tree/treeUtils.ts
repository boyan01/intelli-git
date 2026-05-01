import type { TreeNode } from '../common/BasicTreeView';

export function compactSingleChildFolders<T>(nodes: TreeNode<T>[]): TreeNode<T>[] {
    return nodes.map(node => {
        if (!node.children || node.children.length === 0) {
            return node;
        }

        node.children = compactSingleChildFolders(node.children);

        let children = node.children;
        while (
            children.length === 1 &&
            children[0].children &&
            children[0].children.length > 0
        ) {
            const child = children[0];
            node.label = `${node.label}/${child.label}`;
            node.id = child.id;
            node.data = child.data;
            node.children = child.children;
            children = child.children!;
        }

        return node;
    });
}
