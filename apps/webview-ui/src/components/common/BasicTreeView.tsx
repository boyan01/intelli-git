import React, { useState, useCallback, useRef, useMemo, useLayoutEffect } from 'react';
import styles from './BasicTreeView.module.css';

const ROW_HEIGHT = 22;
const OVERSCAN_ROWS = 8;

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
    onFocusNodeChange?: (node: TreeNode<T>) => void;
    onFocusChange?: (focused: boolean) => void;
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
    rootContextData?: Record<string, unknown>;
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

interface TreeNodeItemProps<T> {
    node: TreeNode<T>;
    depth: number;
    expandedIds: Set<string>;
    selectedId?: string;
    focusedId: string | null;
    dragOverId: string | null;
    toggleNode: (id: string) => void;
    onSelect?: (node: TreeNode<T>) => void;
    onDoubleClick?: (node: TreeNode<T>) => void;
    onContextMenu?: (e: React.MouseEvent, node: TreeNode<T>) => void;
    onFocusNodeChange?: (node: TreeNode<T>) => void;
    onFocusChange?: (focused: boolean) => void;
    renderLabel?: (node: TreeNode<T>) => React.ReactNode;
    renderTrailing?: (node: TreeNode<T>) => React.ReactNode;
    getContextData?: (node: TreeNode<T>) => Record<string, unknown> | undefined;
    renderLeading?: (node: TreeNode<T>) => React.ReactNode;
    baseIndent: number;
    indent: number;
    isDraggable?: (node: TreeNode<T>) => boolean;
    isDropTarget?: (node: TreeNode<T>) => boolean;
    getDropTargetRootId?: (node: TreeNode<T>) => string | null;
    onDrop?: (draggedNode: TreeNode<T>, targetNode: TreeNode<T>) => void;
    getDragData?: (node: TreeNode<T>) => Record<string, string>;
    getDragLabel?: (node: TreeNode<T>) => { label: string; count?: number };
    setFocusedId: (id: string | null) => void;
    setDragOverId: (id: string | null) => void;
    focusTree: () => void;
    dragGhostRef: React.RefObject<HTMLDivElement | null>;
    draggedNodeRef: React.MutableRefObject<TreeNode<T> | null>;
    clearDragTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
}

interface FlatTreeNode<T> {
    node: TreeNode<T>;
    depth: number;
}

function flattenVisibleNodes<T>(nodes: TreeNode<T>[], expandedIds: Set<string>): FlatTreeNode<T>[] {
    const result: FlatTreeNode<T>[] = [];
    const stack = nodes.map(node => ({ node, depth: 0 })).reverse();

    while (stack.length > 0) {
        const item = stack.pop()!;
        result.push(item);

        const children = item.node.children;
        if (children && children.length > 0 && expandedIds.has(item.node.id)) {
            for (let i = children.length - 1; i >= 0; i--) {
                stack.push({ node: children[i], depth: item.depth + 1 });
            }
        }
    }

    return result;
}

function getScrollParent(element: HTMLElement | null): HTMLElement | Window {
    let current = element?.parentElement ?? null;

    while (current) {
        const style = window.getComputedStyle(current);
        const overflowY = style.overflowY;
        if ((overflowY === 'auto' || overflowY === 'scroll') && current.clientHeight > 0) {
            return current;
        }
        current = current.parentElement;
    }

    return window;
}

const TreeNodeItem = <T,>(props: TreeNodeItemProps<T>) => {
    const {
        node, depth, expandedIds, selectedId, focusedId, dragOverId,
        toggleNode, onSelect, onDoubleClick, onContextMenu, onFocusNodeChange,
        renderLabel, renderTrailing, getContextData, renderLeading,
        baseIndent, indent, isDraggable, isDropTarget,
        getDropTargetRootId, onDrop, getDragData, getDragLabel,
        setFocusedId, setDragOverId, focusTree, dragGhostRef,
        draggedNodeRef, clearDragTimeoutRef
    } = props;

    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = expandedIds.has(node.id);
    const isSelected = selectedId === node.id;
    const isLeaf = !hasChildren;

    const contextData = getContextData?.(node);
    const leadingContent = renderLeading?.(node);
    const canDrag = isDraggable?.(node) ?? false;
    const canDrop = isDropTarget?.(node) ?? false;
    const isDragOver = dragOverId === node.id;

    const handleDragStartWrapped = (e: React.DragEvent) => {
        if (!canDrag) return;
        draggedNodeRef.current = node;
        e.dataTransfer.effectAllowed = 'all';
        e.dataTransfer.setData('text/plain', node.id);

        if (getDragData) {
            const data = getDragData(node);
            Object.entries(data).forEach(([key, value]) => {
                e.dataTransfer.setData(key, value);
            });
        }

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
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        if (!canDrop) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';

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

        if (relatedTarget && currentTarget.contains(relatedTarget)) {
            return;
        }

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

    return (
        <div
            className={`${styles.node} ${isSelected ? styles.selected : ''} ${focusedId === node.id ? styles.focused : ''} ${isDragOver ? styles.dragOver : ''}`}
            style={{ paddingLeft: `${baseIndent + depth * indent}px` }}
            draggable={canDrag}
            onDragStart={handleDragStartWrapped}
            onDragOver={handleDragOver}
            onDragEnter={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onDragEnd={() => { draggedNodeRef.current = null; setDragOverId(null); }}
            onClick={(e) => {
                e.stopPropagation();
                focusTree();
                setFocusedId(node.id);
                onFocusNodeChange?.(node);
                if (isLeaf) {
                    onSelect?.(node);
                } else {
                    toggleNode(node.id);
                }
            }}
            onDoubleClick={(e) => {
                e.stopPropagation();
                focusTree();
                onDoubleClick?.(node);
            }}
            onContextMenu={(e) => {
                focusTree();
                setFocusedId(node.id);
                onFocusNodeChange?.(node);
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

            {leadingContent && <div className={styles.leading}>{leadingContent}</div>}

            {node.icon && (
                <div className={styles.icon}>
                    <i className={`codicon codicon-${node.icon}`} />
                </div>
            )}

            <div className={styles.label} title={node.title ?? node.label}>
                {renderLabel ? renderLabel(node) : node.label}
            </div>

            {renderTrailing && <div className={styles.trailing}>{renderTrailing(node)}</div>}
        </div>
    );
};

function BasicTreeViewInner<T>(
    props: BasicTreeViewProps<T>,
    ref: React.ForwardedRef<BasicTreeViewRef>
) {
    const {
        nodes, expandedIds: controlledExpandedIds, selectedId, defaultExpandAll = false,
        onToggle, onSelect, onDoubleClick, onContextMenu, onFocusNodeChange, onFocusChange, renderLabel, renderTrailing,
        getContextData, indent = 8, baseIndent = 0, renderLeading, isDraggable, isDropTarget,
        getDropTargetRootId, onDrop, getDragData, getDragLabel, rootContextData
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
    const [visibleRange, setVisibleRange] = useState({ start: 0, end: 80 });

    const expandedIds = controlledExpandedIds ?? internalExpandedIds;
    const flatNodes = useMemo(() => flattenVisibleNodes(nodes, expandedIds), [nodes, expandedIds]);
    const totalHeight = flatNodes.length * ROW_HEIGHT;
    const rangeStart = Math.min(visibleRange.start, flatNodes.length);
    const rangeEnd = Math.min(Math.max(visibleRange.end, rangeStart), flatNodes.length);
    const visibleItems = flatNodes.slice(rangeStart, rangeEnd);
    const topSpacerHeight = rangeStart * ROW_HEIGHT;
    const bottomSpacerHeight = Math.max(0, totalHeight - rangeEnd * ROW_HEIGHT);

    const focusTree = useCallback(() => {
        rootRef.current?.focus();
    }, []);

    const toggleNode = useCallback((id: string) => {
        const isExpanded = expandedIds.has(id);
        onToggle?.(id, !isExpanded);
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

    const updateVisibleRange = useCallback(() => {
        const root = rootRef.current;
        if (!root) return;

        const scrollParent = getScrollParent(root);
        const rootRect = root.getBoundingClientRect();
        const viewportTop = scrollParent instanceof Window ? 0 : scrollParent.getBoundingClientRect().top;
        const viewportHeight = scrollParent instanceof Window ? window.innerHeight : scrollParent.clientHeight;
        const viewportBottom = viewportTop + viewportHeight;
        const visibleTop = Math.max(0, viewportTop - rootRect.top);
        const visibleBottom = Math.min(totalHeight, viewportBottom - rootRect.top);
        const nextStart = Math.max(0, Math.floor(visibleTop / ROW_HEIGHT) - OVERSCAN_ROWS);
        const nextEnd = Math.min(flatNodes.length, Math.ceil(visibleBottom / ROW_HEIGHT) + OVERSCAN_ROWS);
        const end = Math.max(nextEnd, Math.min(flatNodes.length, nextStart + 1));

        setVisibleRange(prev => (
            prev.start === nextStart && prev.end === end ? prev : { start: nextStart, end }
        ));
    }, [flatNodes.length, totalHeight]);

    useLayoutEffect(() => {
        const root = rootRef.current;
        if (!root) return;

        const scrollParent = getScrollParent(root);
        const scrollTarget: HTMLElement | Window = scrollParent;
        const resizeTarget = scrollParent instanceof Window ? window : scrollParent;
        let frameId: number | null = null;

        const scheduleUpdate = () => {
            if (frameId !== null) return;
            frameId = window.requestAnimationFrame(() => {
                frameId = null;
                updateVisibleRange();
            });
        };

        updateVisibleRange();
        scrollTarget.addEventListener('scroll', scheduleUpdate, { passive: true });
        window.addEventListener('resize', scheduleUpdate);

        const resizeObserver = typeof ResizeObserver !== 'undefined'
            ? new ResizeObserver(scheduleUpdate)
            : null;
        resizeObserver?.observe(root);
        if (resizeTarget instanceof HTMLElement) {
            resizeObserver?.observe(resizeTarget);
        }

        return () => {
            scrollTarget.removeEventListener('scroll', scheduleUpdate);
            window.removeEventListener('resize', scheduleUpdate);
            resizeObserver?.disconnect();
            if (frameId !== null) {
                window.cancelAnimationFrame(frameId);
            }
        };
    }, [updateVisibleRange]);

    React.useImperativeHandle(ref, () => ({
        expandAll: () => {
            const allIds = getAllExpandableIds(nodes);
            if (!controlledExpandedIds) setInternalExpandedIds(allIds);
            allIds.forEach(id => onToggle?.(id, true));
        },
        collapseAll: () => {
            if (!controlledExpandedIds) setInternalExpandedIds(new Set());
            expandedIds.forEach(id => onToggle?.(id, false));
        }
    }), [nodes, controlledExpandedIds, onToggle, expandedIds]);

    return (
        <div
            ref={rootRef}
            className={styles.root}
            tabIndex={0}
            onFocus={() => onFocusChange?.(true)}
            onBlur={() => onFocusChange?.(false)}
            {...(rootContextData ? { 'data-vscode-context': JSON.stringify(rootContextData) } : {})}
        >
            <div className={styles.virtualSpacer} style={{ height: `${topSpacerHeight}px` }} />
            {visibleItems.map(({ node, depth }) => (
                <TreeNodeItem
                    key={node.id}
                    node={node}
                    depth={depth}
                    expandedIds={expandedIds}
                    selectedId={selectedId}
                    focusedId={focusedId}
                    dragOverId={dragOverId}
                    toggleNode={toggleNode}
                    onSelect={onSelect}
                    onDoubleClick={onDoubleClick}
                    onContextMenu={onContextMenu}
                    onFocusNodeChange={onFocusNodeChange}
                    renderLabel={renderLabel}
                    renderTrailing={renderTrailing}
                    getContextData={getContextData}
                    renderLeading={renderLeading}
                    baseIndent={baseIndent}
                    indent={indent}
                    isDraggable={isDraggable}
                    isDropTarget={isDropTarget}
                    getDropTargetRootId={getDropTargetRootId}
                    onDrop={onDrop}
                    getDragData={getDragData}
                    getDragLabel={getDragLabel}
                    setFocusedId={setFocusedId}
                    setDragOverId={setDragOverId}
                    focusTree={focusTree}
                    dragGhostRef={dragGhostRef}
                    draggedNodeRef={draggedNodeRef}
                    clearDragTimeoutRef={clearDragTimeoutRef}
                />
            ))}
            <div className={styles.virtualSpacer} style={{ height: `${bottomSpacerHeight}px` }} />
            <div ref={dragGhostRef} style={{ position: 'absolute', top: '-1000px', left: '-1000px', display: 'flex', alignItems: 'center', padding: '4px 8px', backgroundColor: 'var(--vscode-list-hoverBackground)', border: '1px solid var(--vscode-list-focusOutline)', borderRadius: '5px', color: 'var(--vscode-foreground)', fontFamily: 'var(--vscode-font-family)', fontSize: '13px', pointerEvents: 'none', zIndex: 9999, whiteSpace: 'nowrap' }}>
                <div className="drag-badge" style={{ display: 'none', backgroundColor: 'var(--vscode-badge-background)', color: 'var(--vscode-badge-foreground)', borderRadius: '10px', padding: '0 6px', marginRight: '6px', fontSize: '11px', height: '16px', alignItems: 'center', justifyContent: 'center', minWidth: '16px' }}>0</div>
                <span className="drag-label"></span>
            </div>
        </div>
    );
}

export const BasicTreeView = React.forwardRef(BasicTreeViewInner) as <T>(
    props: BasicTreeViewProps<T> & { ref?: React.Ref<BasicTreeViewRef> }
) => React.ReactElement;
