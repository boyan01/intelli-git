import React, { useState, useCallback, useRef, useEffect } from 'react';
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
    // Drag and drop support
    isDraggable?: (node: TreeNode<T>) => boolean;
    isDropTarget?: (node: TreeNode<T>) => boolean;
    getDropTargetRootId?: (node: TreeNode<T>) => string | null;
    renderDragImage?: (node: TreeNode<T>) => React.ReactNode;
    getDragData?: (node: TreeNode<T>) => Record<string, string>;
    getDragLabel?: (node: TreeNode<T>) => { label: string; count?: number };
    onDrop?: (draggedNode: TreeNode<T>, targetNode: TreeNode<T>) => void;
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
        renderLeading,
        isDraggable,
        isDropTarget,
        getDropTargetRootId,
        onDrop,
        getDragData,
        getDragLabel
    } = props;

    const rootRef = useRef<HTMLDivElement>(null);
    const dragGhostRef = useRef<HTMLDivElement>(null);
    const [focusedId, setFocusedId] = useState<string | null>(null);
    const [dragOverId, setDragOverId] = useState<string | null>(null);
    const draggedNodeRef = useRef<TreeNode<T> | null>(null);
    const clearDragTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

    // Clear timeout on unmount
    useEffect(() => {
        return () => {
            if (clearDragTimeoutRef.current) {
                clearTimeout(clearDragTimeoutRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (!controlledExpandedIds) return;

        // Sync internal state with controlled state if needed
        if (controlledExpandedIds !== internalExpandedIds) {
            // We can update internal if needed, but it's derived
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
        const leadingContent = renderLeading?.(node);
        const canDrag = isDraggable?.(node) ?? false;
        const canDrop = isDropTarget?.(node) ?? false;
        const isDragOver = dragOverId === node.id;

        const handleDragStart = (e: React.DragEvent) => {
            if (!canDrag) return;
            draggedNodeRef.current = node;
            e.dataTransfer.effectAllowed = 'all';
            e.dataTransfer.setData('text/plain', node.id);

            // Populate custom drag data if provided (e.g., text/uri-list)
            if (getDragData) {
                const data = getDragData(node);
                Object.entries(data).forEach(([key, value]) => {
                    e.dataTransfer.setData(key, value);
                });
            }
        };

        const handleDragStartWrapped = (e: React.DragEvent) => {
            handleDragStart(e);

            // Custom drag image using ghost element
            if (dragGhostRef.current && getDragLabel) {
                const info = getDragLabel(node);
                const ghost = dragGhostRef.current;
                const badge = ghost.querySelector('.drag-badge') as HTMLElement;
                const label = ghost.querySelector('.drag-label') as HTMLElement;

                if (label) label.textContent = info.label;
                if (badge) {
                    if (info.count && info.count > 1) {
                        badge.style.display = 'flex';
                        badge.textContent = info.count.toString();
                    } else {
                        badge.style.display = 'none';
                    }
                }
                e.dataTransfer.setDragImage(ghost, -10, -10);
            } else {
                // Fallback to data-drag-label
                const currentTarget = e.currentTarget as HTMLElement;
                const customLabel = currentTarget.querySelector('[data-drag-label="true"]');
                if (customLabel) {
                    e.dataTransfer.setDragImage(customLabel, 0, 0);
                }
            }
        };


        const handleDragOver = (e: React.DragEvent) => {
            if (!canDrop) return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'copy';

            // Clear any pending cleanup
            if (clearDragTimeoutRef.current) {
                clearTimeout(clearDragTimeoutRef.current);
                clearDragTimeoutRef.current = null;
            }

            // Use getDropTargetRootId if provided, otherwise use node.id
            const targetId = getDropTargetRootId?.(node) ?? node.id;
            if (dragOverId !== targetId) {
                setDragOverId(targetId);
            }
        };

        const handleDragEnter = (e: React.DragEvent) => {
            if (!canDrop) return;
            e.preventDefault();
            e.stopPropagation();

            // Clear any pending cleanup
            if (clearDragTimeoutRef.current) {
                clearTimeout(clearDragTimeoutRef.current);
                clearDragTimeoutRef.current = null;
            }

            const targetId = getDropTargetRootId?.(node) ?? node.id;
            if (dragOverId !== targetId) {
                setDragOverId(targetId);
            }
        };

        const handleDragLeave = (e: React.DragEvent) => {
            e.stopPropagation();
            const relatedTarget = e.relatedTarget as Node | null;
            const currentTarget = e.currentTarget as Node;

            // If moving inside the node (e.g. to child elements), ignore
            if (relatedTarget && currentTarget.contains(relatedTarget)) {
                return;
            }

            // Schedule clear instead of clearing immediately
            // This prevents flickering when moving between nodes that map to the same root target



            if (clearDragTimeoutRef.current) {
                clearTimeout(clearDragTimeoutRef.current);
            }
            clearDragTimeoutRef.current = setTimeout(() => {
                setDragOverId(null);
                clearDragTimeoutRef.current = null;
            }, 50);
        };

        const handleDrop = (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();

            if (clearDragTimeoutRef.current) {
                clearTimeout(clearDragTimeoutRef.current);
                clearDragTimeoutRef.current = null;
            }

            setDragOverId(null);
            if (draggedNodeRef.current && canDrop && onDrop) {
                onDrop(draggedNodeRef.current, node);
            }
            draggedNodeRef.current = null;
        };

        const handleDragEnd = () => {
            draggedNodeRef.current = null;
            setDragOverId(null);
        };

        return (
            <div key={node.id} className={styles.nodeWrapper}>
                <div
                    className={`${styles.node} ${isSelected ? styles.selected : ''} ${focusedId === node.id ? styles.focused : ''} ${isDragOver ? styles.dragOver : ''}`}
                    style={{ paddingLeft: `${baseIndent + depth * indent}px` }}
                    draggable={canDrag}
                    onDragStart={handleDragStartWrapped}
                    onDragOver={handleDragOver}
                    onDragEnter={handleDragEnter}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onDragEnd={handleDragEnd}
                    onClick={(e) => {
                        e.stopPropagation();
                        setFocusedId(node.id);
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
                    onContextMenu={(e) => {
                        setFocusedId(node.id);
                        onContextMenu?.(e, node);
                    }}
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

                    {leadingContent && (
                        <div className={styles.leading}>
                            {leadingContent}
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
    }, [expandedIds, selectedId, focusedId, dragOverId, toggleNode, onSelect, onDoubleClick, onContextMenu, renderLabel, renderTrailing, getContextData, renderLeading, baseIndent, indent, isDraggable, isDropTarget, getDropTargetRootId, onDrop, getDragData, getDragLabel]);

    return (
        <div ref={rootRef} className={styles.root} tabIndex={0}>
            {nodes.map(node => renderNode(node, 0))}
            {/* Hidden drag ghost element */}
            <div
                ref={dragGhostRef}
                style={{
                    position: 'absolute',
                    top: '-1000px',
                    left: '-1000px',
                    display: 'flex',
                    alignItems: 'center',
                    padding: '4px 8px',
                    backgroundColor: 'var(--vscode-list-hoverBackground)', // Use distinct background
                    border: '1px solid var(--vscode-list-focusOutline)',
                    borderRadius: '5px',
                    color: 'var(--vscode-foreground)',
                    fontFamily: 'var(--vscode-font-family)',
                    fontSize: '13px',
                    pointerEvents: 'none',
                    zIndex: 9999,
                    whiteSpace: 'nowrap'
                }}
            >
                <div
                    className="drag-badge"
                    style={{
                        display: 'none',
                        backgroundColor: 'var(--vscode-badge-background)',
                        color: 'var(--vscode-badge-foreground)',
                        borderRadius: '10px',
                        padding: '0 6px',
                        marginRight: '6px',
                        fontSize: '11px',
                        height: '16px',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minWidth: '16px'
                    }}
                >
                    0
                </div>
                <span className="drag-label"></span>
            </div>
        </div>
    );
}

export const BasicTreeView = React.forwardRef(BasicTreeViewInner) as <T>(
    props: BasicTreeViewProps<T> & { ref?: React.Ref<BasicTreeViewRef> }
) => React.ReactElement;
