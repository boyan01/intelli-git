import React, { useState, useCallback, useRef, useMemo, useLayoutEffect, useEffect } from 'react';
import styles from './BasicTreeView.module.css';

const ROW_HEIGHT = 22;
const OVERSCAN_ROWS = 8;
const DRAG_AUTO_SCROLL_EDGE = 72;
const DRAG_AUTO_SCROLL_MAX_SPEED = 18;

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
    stickyHeaders?: boolean;
    isStickyHeader?: (node: TreeNode<T>) => boolean;
    onToggle?: (id: string, expanded: boolean) => void;
    onSelect?: (node: TreeNode<T>) => void;
    onAction?: (node: TreeNode<T>) => void;
    onDoubleClick?: (node: TreeNode<T>) => void;
    onContextMenu?: (e: React.MouseEvent, node: TreeNode<T>) => void;
    onFocusNodeChange?: (node: TreeNode<T>) => void;
    onFocusChange?: (focused: boolean) => void;
    renderLabel?: (node: TreeNode<T>) => React.ReactNode;
    renderTrailing?: (node: TreeNode<T>) => React.ReactNode;
    getNodeClassName?: (node: TreeNode<T>) => string | undefined;
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
    ariaLabel?: string;
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
    isStickyClone?: boolean;
    expandedIds: Set<string>;
    selectedId?: string;
    focusedId: string | null;
    dragOverId: string | null;
    toggleNode: (id: string) => void;
    onSelect?: (node: TreeNode<T>) => void;
    onAction?: (node: TreeNode<T>) => void;
    onDoubleClick?: (node: TreeNode<T>) => void;
    onContextMenu?: (e: React.MouseEvent, node: TreeNode<T>) => void;
    onFocusNodeChange?: (node: TreeNode<T>) => void;
    onFocusChange?: (focused: boolean) => void;
    renderLabel?: (node: TreeNode<T>) => React.ReactNode;
    renderTrailing?: (node: TreeNode<T>) => React.ReactNode;
    getNodeClassName?: (node: TreeNode<T>) => string | undefined;
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
    scheduleDragAutoScroll: (clientY: number) => void;
    startDragAutoScrollTracking: () => void;
    stopDragAutoScrollTracking: () => void;
    nodeElementId?: string;
    ariaSetSize?: number;
    ariaPosInSet?: number;
    setNodeElement: (nodeId: string, element: HTMLDivElement | null) => void;
}

interface FlatTreeNode<T> {
    node: TreeNode<T>;
    depth: number;
    ancestorIds: string[];
}

interface StickyHeaderState<T> {
    item: FlatTreeNode<T>;
    offset: number;
}

function flattenVisibleNodes<T>(nodes: TreeNode<T>[], expandedIds: Set<string>): FlatTreeNode<T>[] {
    const result: FlatTreeNode<T>[] = [];
    const stack = nodes.map(node => ({ node, depth: 0, ancestorIds: [] as string[] })).reverse();

    while (stack.length > 0) {
        const item = stack.pop()!;
        result.push(item);

        const children = item.node.children;
        if (children && children.length > 0 && expandedIds.has(item.node.id)) {
            for (let i = children.length - 1; i >= 0; i--) {
                stack.push({
                    node: children[i],
                    depth: item.depth + 1,
                    ancestorIds: [...item.ancestorIds, item.node.id]
                });
            }
        }
    }

    return result;
}

function getStickyHeaderStates<T>(
    flatNodes: FlatTreeNode<T>[],
    flatNodeIndexById: Map<string, number>,
    visibleTop: number,
    stickyHeaders: boolean,
    isStickyHeader?: (node: TreeNode<T>) => boolean
): StickyHeaderState<T>[] {
    if (!stickyHeaders || flatNodes.length === 0) {
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

    const topIndex = Math.min(
        flatNodes.length - 1,
        Math.max(0, Math.floor(visibleTop / ROW_HEIGHT))
    );

    let lastActiveIndex = topIndex;
    while (lastActiveIndex + 1 < flatNodes.length) {
        const nextNode = flatNodes[lastActiveIndex + 1];
        const stickyDepth = getStickyDepth(nextNode);
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
        ...(canStick(lastActiveNode.node) ? [lastActiveNode.node.id] : [])
    ];

    const result: StickyHeaderState<T>[] = [];

    for (const candidateId of candidateIds) {
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
            offset
        });
    }

    return result;
}

function applyStickyHeaderTransforms<T>(
    elements: Map<string, HTMLDivElement>,
    states: StickyHeaderState<T>[],
    hideMissing = true
) {
    const stateById = new Map(states.map(state => [state.item.node.id, state]));
    elements.forEach((element, id) => {
        const state = stateById.get(id);
        if (state) {
            element.style.transform = `translateY(${state.offset}px)`;
            element.style.zIndex = `${100 - state.item.depth}`;
        } else if (hideMissing) {
            element.style.transform = 'translateY(-100%)';
            element.style.zIndex = '1';
        }
    });
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

function getScrollViewport(scrollTarget: HTMLElement | Window) {
    if (scrollTarget instanceof Window) {
        return {
            top: 0,
            bottom: window.innerHeight,
            height: window.innerHeight
        };
    }

    const rect = scrollTarget.getBoundingClientRect();
    return {
        top: rect.top,
        bottom: rect.bottom,
        height: rect.height
    };
}

function scrollTargetBy(scrollTarget: HTMLElement | Window, delta: number) {
    if (scrollTarget instanceof Window) {
        scrollTarget.scrollBy({ top: delta });
        return;
    }

    scrollTarget.scrollTop += delta;
}

function getTreeNodeElementId(nodeId: string): string {
    return `basic-tree-node-${encodeURIComponent(nodeId)}`;
}

function isInteractiveKeyboardTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
        return false;
    }

    return !!target.closest('button, input, textarea, select, [contenteditable="true"], [role="button"]');
}

const TreeNodeItem = <T,>(props: TreeNodeItemProps<T>) => {
    const {
        node, depth, isStickyClone = false, expandedIds, selectedId, focusedId, dragOverId,
        toggleNode, onSelect, onAction, onDoubleClick, onContextMenu, onFocusNodeChange,
        renderLabel, renderTrailing, getNodeClassName, getContextData, renderLeading,
        baseIndent, indent, isDraggable, isDropTarget,
        getDropTargetRootId, onDrop, getDragData, getDragLabel,
        setFocusedId, setDragOverId, focusTree, dragGhostRef,
        draggedNodeRef, clearDragTimeoutRef, scheduleDragAutoScroll,
        startDragAutoScrollTracking, stopDragAutoScrollTracking,
        nodeElementId, ariaSetSize, ariaPosInSet, setNodeElement
    } = props;

    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = expandedIds.has(node.id);
    const isSelected = selectedId === node.id;
    const isLeaf = !hasChildren;

    const contextData = getContextData?.(node);
    const nodeClassName = getNodeClassName?.(node);
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

        const root = e.currentTarget.closest('[data-basic-tree-root="true"]');
        window.setTimeout(() => {
            if (draggedNodeRef.current) {
                root?.classList.add(styles.dragging);
                startDragAutoScrollTracking();
            }
        }, 0);
    };

    const handleDragOver = (e: React.DragEvent) => {
        if (!canDrop) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        scheduleDragAutoScroll(e.clientY);

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
        stopDragAutoScrollTracking();
        e.currentTarget.closest('[data-basic-tree-root="true"]')?.classList.remove(styles.dragging);
    };

    return (
        <div
            ref={(element) => {
                if (!isStickyClone) {
                    setNodeElement(node.id, element);
                }
            }}
            className={`${styles.node} ${nodeClassName || ''} ${isSelected ? styles.selected : ''} ${focusedId === node.id ? styles.focused : ''} ${isDragOver ? styles.dragOver : ''} ${isStickyClone ? styles.stickyNode : ''}`}
            id={isStickyClone ? undefined : nodeElementId}
            role={isStickyClone ? 'presentation' : 'treeitem'}
            aria-hidden={isStickyClone ? true : undefined}
            aria-level={isStickyClone ? undefined : depth + 1}
            aria-expanded={isStickyClone || !hasChildren ? undefined : isExpanded}
            aria-selected={isStickyClone ? undefined : isSelected}
            aria-setsize={isStickyClone ? undefined : ariaSetSize}
            aria-posinset={isStickyClone ? undefined : ariaPosInSet}
            tabIndex={isStickyClone ? undefined : focusedId === node.id ? 0 : -1}
            style={{ paddingLeft: `${baseIndent + depth * indent}px` }}
            draggable={canDrag}
            onDragStart={handleDragStartWrapped}
            onDragOver={handleDragOver}
            onDragEnter={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onDragEnd={(e) => {
                draggedNodeRef.current = null;
                setDragOverId(null);
                stopDragAutoScrollTracking();
                e.currentTarget.closest('[data-basic-tree-root="true"]')?.classList.remove(styles.dragging);
            }}
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
                if (isLeaf) {
                    (onAction ?? onDoubleClick)?.(node);
                } else {
                    toggleNode(node.id);
                }
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
        stickyHeaders = false, isStickyHeader,
        onToggle, onSelect, onAction, onDoubleClick, onContextMenu, onFocusNodeChange, onFocusChange, renderLabel, renderTrailing,
        getNodeClassName, getContextData, indent = 8, baseIndent = 0, renderLeading, isDraggable, isDropTarget,
        getDropTargetRootId, onDrop, getDragData, getDragLabel, rootContextData, ariaLabel
    } = props;

    const rootRef = useRef<HTMLDivElement>(null);
    const stickyHeaderRefs = useRef(new Map<string, HTMLDivElement>());
    const nodeElementRefs = useRef(new Map<string, HTMLDivElement>());
    const dragGhostRef = useRef<HTMLDivElement>(null);
    const [focusedId, setFocusedId] = useState<string | null>(null);
    const [isTreeFocused, setIsTreeFocused] = useState(false);
    const [dragOverId, setDragOverId] = useState<string | null>(null);
    const draggedNodeRef = useRef<TreeNode<T> | null>(null);
    const clearDragTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const dragAutoScrollFrameRef = useRef<number | null>(null);
    const dragAutoScrollVelocityRef = useRef(0);
    const dragAutoScrollListenerRef = useRef<((event: DragEvent) => void) | null>(null);
    const [internalExpandedIds, setInternalExpandedIds] = useState<Set<string>>(() => {
        if (controlledExpandedIds) return controlledExpandedIds;
        return defaultExpandAll ? getAllExpandableIds(nodes) : new Set();
    });
    const [visibleRange, setVisibleRange] = useState({ start: 0, end: 80, visibleTop: 0 });

    const expandedIds = controlledExpandedIds ?? internalExpandedIds;
    const flatNodes = useMemo(() => flattenVisibleNodes(nodes, expandedIds), [nodes, expandedIds]);
    const totalHeight = flatNodes.length * ROW_HEIGHT;
    const rangeStart = Math.min(visibleRange.start, flatNodes.length);
    const rangeEnd = Math.min(Math.max(visibleRange.end, rangeStart), flatNodes.length);
    const visibleItems = flatNodes.slice(rangeStart, rangeEnd);
    const topSpacerHeight = rangeStart * ROW_HEIGHT;
    const bottomSpacerHeight = Math.max(0, totalHeight - rangeEnd * ROW_HEIGHT);
    const flatNodeIndexById = useMemo(() => {
        const result = new Map<string, number>();
        flatNodes.forEach((item, index) => result.set(item.node.id, index));
        return result;
    }, [flatNodes]);
    const stickyHeaderStates = getStickyHeaderStates(
        flatNodes,
        flatNodeIndexById,
        visibleRange.visibleTop,
        stickyHeaders,
        isStickyHeader
    );

    useLayoutEffect(() => {
        applyStickyHeaderTransforms(stickyHeaderRefs.current, stickyHeaderStates);
    }, [stickyHeaderStates]);

    const focusTree = useCallback(() => {
        rootRef.current?.focus();
    }, []);

    const setNodeElement = useCallback((nodeId: string, element: HTMLDivElement | null) => {
        if (element) {
            nodeElementRefs.current.set(nodeId, element);
        } else {
            nodeElementRefs.current.delete(nodeId);
        }
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

    const scrollIndexIntoView = useCallback((index: number) => {
        const root = rootRef.current;
        if (!root) return;

        const scrollParent = getScrollParent(root);
        const rootRect = root.getBoundingClientRect();
        const viewportTop = scrollParent instanceof Window ? 0 : scrollParent.getBoundingClientRect().top;
        const viewportBottom = scrollParent instanceof Window ? window.innerHeight : scrollParent.getBoundingClientRect().bottom;
        const itemTop = rootRect.top + index * ROW_HEIGHT;
        const itemBottom = itemTop + ROW_HEIGHT;

        if (itemTop < viewportTop) {
            scrollTargetBy(scrollParent, itemTop - viewportTop);
        } else if (itemBottom > viewportBottom) {
            scrollTargetBy(scrollParent, itemBottom - viewportBottom);
        }
    }, []);

    const focusItemAtIndex = useCallback((index: number) => {
        if (flatNodes.length === 0) return;

        const boundedIndex = Math.max(0, Math.min(flatNodes.length - 1, index));
        const item = flatNodes[boundedIndex];
        setFocusedId(item.node.id);
        onFocusNodeChange?.(item.node);
        scrollIndexIntoView(boundedIndex);
    }, [flatNodes, onFocusNodeChange, scrollIndexIntoView]);

    const activateItem = useCallback((item: FlatTreeNode<T>) => {
        const hasChildren = !!item.node.children?.length;
        if (hasChildren) {
            toggleNode(item.node.id);
            return;
        }

        (onAction ?? onDoubleClick ?? onSelect)?.(item.node);
    }, [onAction, onDoubleClick, onSelect, toggleNode]);

    const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
        if (isInteractiveKeyboardTarget(event.target)) {
            return;
        }

        const currentIndex = focusedId ? flatNodeIndexById.get(focusedId) : undefined;
        const fallbackIndex = selectedId ? flatNodeIndexById.get(selectedId) : undefined;
        const activeIndex = currentIndex ?? fallbackIndex ?? 0;
        const activeItem = flatNodes[activeIndex];

        if (!activeItem) {
            return;
        }

        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                focusItemAtIndex(activeIndex + 1);
                break;
            case 'ArrowUp':
                event.preventDefault();
                focusItemAtIndex(activeIndex - 1);
                break;
            case 'Home':
                event.preventDefault();
                focusItemAtIndex(0);
                break;
            case 'End':
                event.preventDefault();
                focusItemAtIndex(flatNodes.length - 1);
                break;
            case 'ArrowRight': {
                const hasChildren = !!activeItem.node.children?.length;
                if (!hasChildren) return;

                event.preventDefault();
                if (!expandedIds.has(activeItem.node.id)) {
                    toggleNode(activeItem.node.id);
                    return;
                }
                focusItemAtIndex(activeIndex + 1);
                break;
            }
            case 'ArrowLeft': {
                const hasChildren = !!activeItem.node.children?.length;
                event.preventDefault();

                if (hasChildren && expandedIds.has(activeItem.node.id)) {
                    toggleNode(activeItem.node.id);
                    return;
                }

                const parentId = activeItem.ancestorIds[activeItem.ancestorIds.length - 1];
                const parentIndex = parentId ? flatNodeIndexById.get(parentId) : undefined;
                if (parentIndex !== undefined) {
                    focusItemAtIndex(parentIndex);
                }
                break;
            }
            case 'Enter':
            case ' ':
                event.preventDefault();
                activateItem(activeItem);
                break;
            case 'ContextMenu': {
                event.preventDefault();
                const element = nodeElementRefs.current.get(activeItem.node.id);
                const rect = element?.getBoundingClientRect();
                element?.dispatchEvent(new MouseEvent('contextmenu', {
                    bubbles: true,
                    cancelable: true,
                    clientX: rect?.left ?? 0,
                    clientY: rect?.bottom ?? 0
                }));
                break;
            }
            case 'F10': {
                if (!event.shiftKey) return;
                event.preventDefault();
                const element = nodeElementRefs.current.get(activeItem.node.id);
                const rect = element?.getBoundingClientRect();
                element?.dispatchEvent(new MouseEvent('contextmenu', {
                    bubbles: true,
                    cancelable: true,
                    clientX: rect?.left ?? 0,
                    clientY: rect?.bottom ?? 0
                }));
                break;
            }
            default:
                break;
        }
    }, [
        activateItem,
        expandedIds,
        flatNodeIndexById,
        flatNodes,
        focusItemAtIndex,
        focusedId,
        selectedId,
        toggleNode
    ]);

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
        const nextStickyHeaderStates = getStickyHeaderStates(
            flatNodes,
            flatNodeIndexById,
            visibleTop,
            stickyHeaders,
            isStickyHeader
        );

        applyStickyHeaderTransforms(stickyHeaderRefs.current, nextStickyHeaderStates, false);

        setVisibleRange(prev => (
            prev.start === nextStart && prev.end === end && prev.visibleTop === visibleTop
                ? prev
                : { start: nextStart, end, visibleTop }
        ));
    }, [flatNodeIndexById, flatNodes, isStickyHeader, stickyHeaders, totalHeight]);

    useEffect(() => {
        if (focusedId && flatNodeIndexById.has(focusedId)) {
            return;
        }

        const selectedIndex = selectedId ? flatNodeIndexById.get(selectedId) : undefined;
        const fallbackItem = flatNodes[selectedIndex ?? 0];
        setFocusedId(fallbackItem?.node.id ?? null);
    }, [flatNodeIndexById, flatNodes, focusedId, selectedId]);

    useLayoutEffect(() => {
        if (!isTreeFocused || !focusedId) {
            return;
        }

        nodeElementRefs.current.get(focusedId)?.focus({ preventScroll: true });
    }, [focusedId, isTreeFocused, visibleItems]);

    const handleRootFocus = useCallback((event: React.FocusEvent<HTMLDivElement>) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) {
            return;
        }

        setIsTreeFocused(true);
        onFocusChange?.(true);

        if (!focusedId) {
            const selectedIndex = selectedId ? flatNodeIndexById.get(selectedId) : undefined;
            focusItemAtIndex(selectedIndex ?? 0);
        }
    }, [flatNodeIndexById, focusItemAtIndex, focusedId, onFocusChange, selectedId]);

    const handleRootBlur = useCallback((event: React.FocusEvent<HTMLDivElement>) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) {
            return;
        }

        setIsTreeFocused(false);
        onFocusChange?.(false);
    }, [onFocusChange]);

    const stopDragAutoScroll = useCallback(() => {
        dragAutoScrollVelocityRef.current = 0;
        if (dragAutoScrollFrameRef.current !== null) {
            window.cancelAnimationFrame(dragAutoScrollFrameRef.current);
            dragAutoScrollFrameRef.current = null;
        }
    }, []);

    const stopDragAutoScrollTracking = useCallback(() => {
        stopDragAutoScroll();
        if (dragAutoScrollListenerRef.current) {
            document.removeEventListener('dragover', dragAutoScrollListenerRef.current, true);
            dragAutoScrollListenerRef.current = null;
        }
    }, [stopDragAutoScroll]);

    const scheduleDragAutoScroll = useCallback((clientY: number) => {
        const root = rootRef.current;
        if (!root) return;

        const scrollTarget = getScrollParent(root);
        const viewport = getScrollViewport(scrollTarget);
        const edgeSize = Math.min(DRAG_AUTO_SCROLL_EDGE, Math.max(24, viewport.height / 3));
        const topDistance = clientY - viewport.top;
        const bottomDistance = viewport.bottom - clientY;
        let velocity = 0;

        if (topDistance < edgeSize) {
            const strength = Math.max(0, Math.min(1, (edgeSize - topDistance) / edgeSize));
            velocity = -Math.ceil(strength * DRAG_AUTO_SCROLL_MAX_SPEED);
        } else if (bottomDistance < edgeSize) {
            const strength = Math.max(0, Math.min(1, (edgeSize - bottomDistance) / edgeSize));
            velocity = Math.ceil(strength * DRAG_AUTO_SCROLL_MAX_SPEED);
        }

        dragAutoScrollVelocityRef.current = velocity;
        if (velocity === 0) {
            stopDragAutoScroll();
            return;
        }

        if (dragAutoScrollFrameRef.current !== null) {
            return;
        }

        const tick = () => {
            const nextVelocity = dragAutoScrollVelocityRef.current;
            if (nextVelocity === 0) {
                dragAutoScrollFrameRef.current = null;
                return;
            }

            scrollTargetBy(scrollTarget, nextVelocity);
            updateVisibleRange();
            dragAutoScrollFrameRef.current = window.requestAnimationFrame(tick);
        };

        dragAutoScrollFrameRef.current = window.requestAnimationFrame(tick);
    }, [stopDragAutoScroll, updateVisibleRange]);

    const startDragAutoScrollTracking = useCallback(() => {
        if (dragAutoScrollListenerRef.current) {
            return;
        }

        const listener = (event: DragEvent) => {
            scheduleDragAutoScroll(event.clientY);
        };

        document.addEventListener('dragover', listener, true);
        dragAutoScrollListenerRef.current = listener;
    }, [scheduleDragAutoScroll]);

    useEffect(() => stopDragAutoScrollTracking, [stopDragAutoScrollTracking]);

    useLayoutEffect(() => {
        const root = rootRef.current;
        if (!root) return;

        const scrollParent = getScrollParent(root);
        const scrollTarget: HTMLElement | Window = scrollParent;
        const resizeTarget = scrollParent instanceof Window ? window : scrollParent;
        let frameId: number | null = null;

        const updateStickyHeaderPosition = () => {
            const latestRoot = rootRef.current;
            if (!latestRoot) return;

            const rootRect = latestRoot.getBoundingClientRect();
            const viewportTop = scrollParent instanceof Window ? 0 : scrollParent.getBoundingClientRect().top;
            const visibleTop = Math.max(0, viewportTop - rootRect.top);
            const nextStickyHeaderStates = getStickyHeaderStates(
                flatNodes,
                flatNodeIndexById,
                visibleTop,
                stickyHeaders,
                isStickyHeader
            );

            applyStickyHeaderTransforms(stickyHeaderRefs.current, nextStickyHeaderStates, false);
        };

        const scheduleUpdate = () => {
            updateStickyHeaderPosition();
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
    }, [flatNodeIndexById, flatNodes, isStickyHeader, stickyHeaders, updateVisibleRange]);

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

    const activeDescendantId = focusedId && flatNodeIndexById.has(focusedId)
        ? getTreeNodeElementId(focusedId)
        : undefined;

    return (
        <div
            ref={rootRef}
            className={styles.root}
            role="tree"
            aria-label={ariaLabel}
            aria-activedescendant={activeDescendantId}
            tabIndex={0}
            onFocus={handleRootFocus}
            onBlur={handleRootBlur}
            onKeyDown={handleKeyDown}
            {...(rootContextData ? { 'data-vscode-context': JSON.stringify(rootContextData) } : {})}
            data-basic-tree-root="true"
        >
            {stickyHeaderStates.map(stickyHeaderState => (
                <div
                    key={stickyHeaderState.item.node.id}
                    ref={(element) => {
                        if (element) {
                            stickyHeaderRefs.current.set(stickyHeaderState.item.node.id, element);
                        } else {
                            stickyHeaderRefs.current.delete(stickyHeaderState.item.node.id);
                        }
                    }}
                    className={styles.stickyHeader}
                    style={{ transform: `translateY(${stickyHeaderState.offset}px)` }}
                >
                    <TreeNodeItem
                        node={stickyHeaderState.item.node}
                        depth={stickyHeaderState.item.depth}
                        isStickyClone={true}
                        expandedIds={expandedIds}
                        selectedId={selectedId}
                        focusedId={focusedId}
                        dragOverId={dragOverId}
                        toggleNode={toggleNode}
                        onSelect={onSelect}
                        onAction={onAction}
                        onDoubleClick={onDoubleClick}
                        onContextMenu={onContextMenu}
                        onFocusNodeChange={onFocusNodeChange}
                        renderLabel={renderLabel}
                        renderTrailing={renderTrailing}
                        getNodeClassName={getNodeClassName}
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
                        scheduleDragAutoScroll={scheduleDragAutoScroll}
                        startDragAutoScrollTracking={startDragAutoScrollTracking}
                        stopDragAutoScrollTracking={stopDragAutoScrollTracking}
                        nodeElementId={getTreeNodeElementId(stickyHeaderState.item.node.id)}
                        setNodeElement={setNodeElement}
                    />
                </div>
            ))}
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
                    onAction={onAction}
                    onDoubleClick={onDoubleClick}
                    onContextMenu={onContextMenu}
                    onFocusNodeChange={onFocusNodeChange}
                    renderLabel={renderLabel}
                    renderTrailing={renderTrailing}
                    getNodeClassName={getNodeClassName}
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
                    scheduleDragAutoScroll={scheduleDragAutoScroll}
                    startDragAutoScrollTracking={startDragAutoScrollTracking}
                    stopDragAutoScrollTracking={stopDragAutoScrollTracking}
                    nodeElementId={getTreeNodeElementId(node.id)}
                    setNodeElement={setNodeElement}
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
