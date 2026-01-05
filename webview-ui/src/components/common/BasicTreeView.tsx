import React, { useState, useCallback } from 'react';
import styles from './BasicTreeView.module.css';

/**
 * Generic tree node interface for BasicTreeView.
 * T is the type of custom data attached to each node.
 */
export interface TreeNode<T = unknown> {
    id: string;
    label: string;
    title?: string;
    icon?: string;
    children?: TreeNode<T>[];
    data?: T;
}

export interface BasicTreeViewProps<T = unknown> {
    nodes: TreeNode<T>[];
    expandedIds?: Set<string>;
    selectedId?: string;
    defaultExpandAll?: boolean;
    onToggle?: (id: string, expanded: boolean) => void;
    onSelect?: (node: TreeNode<T>) => void;
    onDoubleClick?: (node: TreeNode<T>) => void;
    onContextMenu?: (e: React.MouseEvent, node: TreeNode<T>) => void;
    renderLabel?: (node: TreeNode<T>) => React.ReactNode;
    renderTrailing?: (node: TreeNode<T>) => React.ReactNode;
    getContextData?: (node: TreeNode<T>) => Record<string, unknown> | undefined;
    indent?: number;
    baseIndent?: number;
    renderLeading?: (node: TreeNode<T>) => React.ReactNode;
}

export interface BasicTreeViewRef {
    expandAll: () => void;
    collapseAll: () => void;
}

function getAllExpandableIds<T>(nodes: TreeNode<T>[]): Set<string> {
    const ids = new Set<string>();
    const traverse = (nodeList: TreeNode<T>[]) => {
        for (const node of nodeList) {
            if (node.children && node.children.length > 0) {
                ids.add(node.id);
                traverse(node.children);
            }
        }
    };
    traverse(nodes);
    return ids;
}

function BasicTreeViewInner<T>(
    props: BasicTreeViewProps<T>,
    ref: React.ForwardedRef<BasicTreeViewRef>
) {
    const {
        nodes,
        expandedIds: controlledExpandedIds,
        selectedId,
        defaultExpandAll = false,
        onToggle,
        onSelect,
        onDoubleClick,
        onContextMenu,
        renderLabel,
        renderTrailing,
        getContextData,
        indent = 8,
        baseIndent = 0,
        renderLeading
    } = props;

    const [internalExpandedIds, setInternalExpandedIds] = useState<Set<string>>(() => {
        if (controlledExpandedIds) return controlledExpandedIds;
        return defaultExpandAll ? getAllExpandableIds(nodes) : new Set();
    });

    const expandedIds = controlledExpandedIds ?? internalExpandedIds;

    const toggleNode = useCallback((id: string) => {
        const isExpanded = expandedIds.has(id);
        if (onToggle) {
            onToggle(id, !isExpanded);
        }
        if (!controlledExpandedIds) {
            setInternalExpandedIds(prev => {
                const next = new Set(prev);
                if (next.has(id)) {
                    next.delete(id);
                } else {
                    next.add(id);
                }
                return next;
            });
        }
    }, [expandedIds, onToggle, controlledExpandedIds]);

    React.useImperativeHandle(ref, () => ({
        expandAll: () => {
            const allIds = getAllExpandableIds(nodes);
            if (!controlledExpandedIds) {
                setInternalExpandedIds(allIds);
            }
            allIds.forEach(id => onToggle?.(id, true));
        },
        collapseAll: () => {
            if (!controlledExpandedIds) {
                setInternalExpandedIds(new Set());
            }
            expandedIds.forEach(id => onToggle?.(id, false));
        }
    }), [nodes, controlledExpandedIds, onToggle, expandedIds]);

    const renderNode = useCallback((node: TreeNode<T>, depth: number): React.ReactNode => {
        const hasChildren = node.children && node.children.length > 0;
        const isExpanded = expandedIds.has(node.id);
        const isSelected = selectedId === node.id;
        const isLeaf = !hasChildren;

        const contextData = getContextData?.(node);

        return (
            <div key={node.id} className={styles.nodeWrapper}>
                <div
                    className={`${styles.node} ${isSelected ? styles.selected : ''}`}
                    style={{ paddingLeft: `${baseIndent + depth * indent}px` }}
                    onClick={(e) => {
                        e.stopPropagation();
                        if (isLeaf) {
                            onSelect?.(node);
                        } else {
                            toggleNode(node.id);
                        }
                    }}
                    onDoubleClick={(e) => {
                        e.stopPropagation();
                        onDoubleClick?.(node);
                    }}
                    onContextMenu={(e) => onContextMenu?.(e, node)}
                    {...(contextData ? { 'data-vscode-context': JSON.stringify(contextData) } : {})}
                >
                    <div
                        className={styles.twistie}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (hasChildren) toggleNode(node.id);
                        }}
                    >
                        {hasChildren && (
                            <i className={`codicon codicon-chevron-${isExpanded ? 'down' : 'right'}`} />
                        )}
                    </div>

                    {renderLeading && (
                        <div className={styles.leading}>
                            {renderLeading(node)}
                        </div>
                    )}

                    {node.icon && (
                        <div className={styles.icon}>
                            <i className={`codicon codicon-${node.icon}`} />
                        </div>
                    )}

                    <div className={styles.label} title={node.title ?? node.label}>
                        {renderLabel ? renderLabel(node) : node.label}
                    </div>

                    {renderTrailing && (
                        <div className={styles.trailing}>
                            {renderTrailing(node)}
                        </div>
                    )}
                </div>

                {hasChildren && isExpanded && (
                    <div className={styles.children}>
                        {node.children!.map(child => renderNode(child, depth + 1))}
                    </div>
                )}
            </div>
        );
    }, [expandedIds, selectedId, toggleNode, onSelect, onDoubleClick, onContextMenu, renderLabel, renderTrailing, getContextData]);

    return (
        <div className={styles.root}>
            {nodes.map(node => renderNode(node, 0))}
        </div>
    );
}

export const BasicTreeView = React.forwardRef(BasicTreeViewInner) as <T>(
    props: BasicTreeViewProps<T> & { ref?: React.Ref<BasicTreeViewRef> }
) => React.ReactElement;
