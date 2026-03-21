import React, { useMemo, useCallback, useRef } from 'react';
import type { ChangelistGroup, FileStatus, LastCommitInfo } from '@shared/messages';
import { BasicTreeView } from '../common/BasicTreeView';
import type { TreeNode, BasicTreeViewRef } from '../common/BasicTreeView';
import { getFileIcon } from '../../lib/fileIcons';
import { rpc, rpcEvents } from '@/lib/rpc_client';
import { logger } from '@/utils/logger';
import styles from '../file-tree/BaseFileTree.module.css';

export interface ChangelistTreeProps {
    groups: ChangelistGroup[];
    viewMode: 'tree' | 'list';
    selectedFiles: Set<string>;
    expandedIds?: Set<string>;
    activeFile?: string | null;
    onToggle?: (id: string, expanded: boolean) => void;
    onToggleFile: (path: string, checked: boolean) => void;
    readonly?: boolean;
    workspaceRoot?: string;
    amendCommit?: LastCommitInfo | null;
}

export interface ChangelistTreeRef {
    expandAll: () => void;
    collapseAll: () => void;
}

type SelectionStatus = 'all' | 'partial' | 'none';

interface FileNodeData {
    path: string;
    isFile: boolean;
    isRoot?: boolean;
    isInactiveGroup?: boolean;
    isStagedGroup?: boolean;
    isAmendCommit?: boolean;
    isAmendFile?: boolean;
    status?: string;
    staged?: boolean;
    inactive?: boolean;
    fileCount: number;
    selectedStatus?: SelectionStatus;
    error?: boolean;
}

const getDirPath = (fullPath: string): string => {
    const lastSlash = fullPath.lastIndexOf('/');
    return lastSlash > 0 ? fullPath.substring(0, lastSlash) : '';
};

const getStatusColor = (status?: string) => {
    if (status === 'C' || status === 'U') return 'var(--vscode-gitDecoration-conflictingResourceForeground)';
    if (status === 'A') return 'var(--vscode-gitDecoration-addedResourceForeground)';
    if (status === 'M') return 'var(--vscode-gitDecoration-modifiedResourceForeground)';
    if (status === 'D') return 'var(--vscode-gitDecoration-deletedResourceForeground)';
    if (status === '?') return 'var(--vscode-gitDecoration-untrackedResourceForeground)';
    return 'var(--vscode-foreground)';
};

const countFiles = (node: TreeNode<FileNodeData>): number => {
    if (node.data?.isFile) return 1;
    if (!node.children) return 0;
    return node.children.reduce((sum, child) => sum + countFiles(child), 0);
};

const getAllFilePaths = (node: TreeNode<FileNodeData>): string[] => {
    if (node.data?.isFile) return [node.data.path];
    if (!node.children) return [];
    return node.children.flatMap(getAllFilePaths);
};

const computeSelection = (nodes: TreeNode<FileNodeData>[], selectedFiles?: Set<string>) => {
    const compute = (node: TreeNode<FileNodeData>): SelectionStatus => {
        if (node.data?.isFile) {
            const status = selectedFiles?.has(node.data.path) ? 'all' : 'none';
            node.data.selectedStatus = status;
            return status;
        }
        if (!node.children || node.children.length === 0) {
            node.data!.selectedStatus = 'none';
            return 'none';
        }
        const childStatuses = node.children.map(compute);
        let status: SelectionStatus;
        if (childStatuses.every(s => s === 'all')) {
            status = 'all';
        } else if (childStatuses.every(s => s === 'none')) {
            status = 'none';
        } else {
            status = 'partial';
        }
        node.data!.selectedStatus = status;
        return status;
    };
    nodes.forEach(compute);
};

const buildTree = (files: FileStatus[]): TreeNode<FileNodeData>[] => {
    const root: TreeNode<FileNodeData>[] = [];
    const map = new Map<string, TreeNode<FileNodeData>>();

    files.forEach(file => {
        const parts = file.path.split('/');
        let currentPath = '';

        parts.forEach((part, index) => {
            const isLast = index === parts.length - 1;
            const parentPath = currentPath;
            currentPath = currentPath ? `${currentPath}/${part}` : part;

            if (!map.has(currentPath)) {
                const node: TreeNode<FileNodeData> = {
                    id: currentPath,
                    label: part,
                    data: {
                        path: currentPath,
                        isFile: isLast,
                        status: isLast ? file.status : undefined,
                        staged: isLast ? file.staged : undefined,
                        inactive: isLast ? file.inactive : undefined,
                        fileCount: 0,
                        error: isLast ? file.error : undefined
                    },
                    children: isLast ? undefined : []
                };

                map.set(currentPath, node);

                if (index === 0) {
                    root.push(node);
                } else {
                    const parent = map.get(parentPath);
                    if (parent && parent.children) {
                        parent.children.push(node);
                    }
                }
            }
        });
    });

    const processNodes = (nodes: TreeNode<FileNodeData>[]) => {
        nodes.sort((a, b) => {
            const aIsFile = a.data?.isFile;
            const bIsFile = b.data?.isFile;
            if (aIsFile === bIsFile) return a.label.localeCompare(b.label);
            return aIsFile ? 1 : -1;
        });
        nodes.forEach(node => {
            if (node.children) processNodes(node.children);
            node.data!.fileCount = countFiles(node);
        });
    };
    processNodes(root);

    const compactFolders = (nodes: TreeNode<FileNodeData>[]): TreeNode<FileNodeData>[] => {
        return nodes.map(node => {
            if (!node.children || node.children.length === 0) {
                return node;
            }
            node.children = compactFolders(node.children);
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
    };

    return compactFolders(root);
};

// Helper to recursively prefix node IDs with group ID
const prefixNodes = (nodes: TreeNode<FileNodeData>[], prefix: string): TreeNode<FileNodeData>[] => {
    return nodes.map(node => ({
        ...node,
        id: `${prefix}/${node.id}`,
        data: node.data,
        children: node.children ? prefixNodes(node.children, prefix) : undefined
    }));
};

export const ChangelistTree = React.forwardRef<ChangelistTreeRef, ChangelistTreeProps>(({
    groups,
    viewMode,
    selectedFiles,
    expandedIds,
    activeFile,
    onToggle,
    onToggleFile,
    readonly = false,
    workspaceRoot,
    amendCommit
}, ref) => {
    const treeRef = useRef<BasicTreeViewRef>(null);
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);

    React.useImperativeHandle(ref, () => ({
        expandAll: () => treeRef.current?.expandAll(),
        collapseAll: () => treeRef.current?.collapseAll()
    }));

    const nodes = useMemo(() => {
        const result: TreeNode<FileNodeData>[] = [];

        // Add changelist groups first
        groups.forEach(group => {
            let children: TreeNode<FileNodeData>[];
            if (viewMode === 'list') {
                children = group.items
                    .map(f => ({
                        id: `${group.id}/${f.path}`,
                        label: f.path.split('/').pop() || f.path,
                        data: {
                            path: f.path,
                            isFile: true,
                            status: f.status,
                            staged: f.staged,
                            inactive: f.inactive,
                            fileCount: 1
                        }
                    }))
                    .sort((a, b) => a.label.localeCompare(b.label));
            } else {
                children = prefixNodes(buildTree(group.items), group.id);
            }

            const totalFiles = children.reduce((sum, n) => sum + countFiles(n), 0);
            result.push({
                id: `__root__${group.id}`,
                label: group.name,
                data: {
                    path: '',
                    isFile: false,
                    isRoot: true,
                    isInactiveGroup: group.id === 'inactive-changes',
                    isStagedGroup: group.id === 'staged-changes',
                    fileCount: totalFiles
                },
                children
            });
        });

        // Add amend commit node at the bottom
        if (amendCommit) {
            const amendChildren: TreeNode<FileNodeData>[] = amendCommit.files.map(f => ({
                id: `amend/${f.path}`,
                label: f.path.split('/').pop() || f.path,
                data: {
                    path: f.path,
                    isFile: true,
                    isAmendFile: true,
                    status: f.status,
                    fileCount: 1
                }
            }));

            result.push({
                id: '__root__amend',
                label: amendCommit.subject,
                data: {
                    path: '',
                    isFile: false,
                    isRoot: true,
                    isAmendCommit: true,
                    fileCount: amendCommit.files.length
                },
                children: amendChildren
            });
        }

        return result;
    }, [groups, viewMode, amendCommit]);

    React.useLayoutEffect(() => {
        computeSelection(nodes, selectedFiles);
        forceUpdate();
    }, [nodes, selectedFiles]);

    const handleNodeClick = useCallback((node: TreeNode<FileNodeData>) => {
        if (node.data?.isFile) {
            if (node.data.status === 'D') {
                rpc.openDiff(node.data.path);
            } else {
                rpc.openFile({ path: node.data.path, preserveFocus: true });
            }
        }
    }, []);

    const handleNodeDoubleClick = useCallback((node: TreeNode<FileNodeData>) => {
        if (node.data?.isFile) {
            if (node.data.status === 'D') {
                rpc.openDiff(node.data.path);
            } else {
                rpc.openFile({ path: node.data.path, preserveFocus: false });
            }
        }
    }, []);

    const handleToggleFile = useCallback((node: TreeNode<FileNodeData>, checked: boolean) => {
        if (readonly || !onToggleFile) return;
        if (node.id === '__root__inactive-changes' || node.id.startsWith('inactive-changes/')) return;
        const paths = getAllFilePaths(node);
        paths.forEach(path => onToggleFile(path, checked));
    }, [readonly, onToggleFile]);

    const renderLeading = useCallback((node: TreeNode<FileNodeData>) => {
        // Don't show checkbox for amend commit nodes
        if (node.data?.isAmendCommit || node.data?.isAmendFile) return null;
        if (node.id === '__root__inactive-changes' || node.id.startsWith('inactive-changes/')) return null;
        if (readonly || !onToggleFile) return null;

        const status = node.data?.selectedStatus ?? 'none';
        return (
            <input
                type="checkbox"
                className={styles.checkbox}
                checked={status === 'all'}
                ref={input => { if (input) input.indeterminate = status === 'partial'; }}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => handleToggleFile(node, e.target.checked)}
            />
        );
    }, [readonly, onToggleFile, handleToggleFile]);

    const renderTrailing = useCallback((node: TreeNode<FileNodeData>) => {
        if (node.data?.isRoot && node.data?.fileCount !== undefined) {
            const isInactiveGroup = node.data.isInactiveGroup;
            const isStagedGroup = node.data.isStagedGroup;
            const paths = node.children ? getAllFilePaths(node) : [];

            const handleAction = async (e: React.MouseEvent, action: 'stage' | 'unstage') => {
                e.stopPropagation();
                if (paths.length === 0) return;

                if (action === 'stage') {
                    await rpc.stageFiles(paths);
                } else {
                    await Promise.all(paths.map(path => rpc.unstage(path)));
                }

                rpcEvents.refresh.emit();
            };

            return (
                <div className={styles.groupTrailing}>
                    {!isInactiveGroup && paths.length > 0 && (
                        <button
                            type="button"
                            className={styles.groupAction}
                            onClick={(e) => handleAction(e, isStagedGroup ? 'unstage' : 'stage')}
                            title={isStagedGroup ? 'Unstage All' : 'Stage All'}
                        >
                            <i className={`codicon ${isStagedGroup ? 'codicon-remove' : 'codicon-add'}`}></i>
                            <span>{isStagedGroup ? 'Unstage All' : 'Stage All'}</span>
                        </button>
                    )}

                    <span className={styles.fileCount} style={{ marginLeft: 0 }}>
                        {node.data.fileCount}
                    </span>
                </div>
            );
        }
        return null;
    }, []);

    const renderLabel = useCallback((node: TreeNode<FileNodeData>) => {
        const isFile = node.data?.isFile;
        const status = node.data?.status;
        const isDeleted = status === 'D';
        const isError = node.data?.error;
        const statusColor = isError ? 'var(--vscode-list-errorForeground)' : getStatusColor(status);
        const isAmendFile = node.data?.isAmendFile;

        const statusClass = status === 'M' ? styles.statusM :
            status === 'A' ? styles.statusA :
                status === 'D' ? styles.statusD :
                    status === 'R' ? styles.statusR :
                        status === '?' ? styles.statusUntracked :
                            status === '!' ? styles.statusIgnored : '';

        const showPath = viewMode === 'list' && (isFile || isAmendFile);

        return (
            <div className={styles.fileItemContent} data-drag-label="true">
                {isFile ? (
                    <>
                        {(status === 'C' || status === 'U') ? (
                            <span className={`codicon codicon-warning ${styles.icon}`} style={{ color: statusColor }}></span>
                        ) : (
                            <span
                                className={styles.fileIconSvg}
                                style={{ color: statusColor || getFileIcon(node.label).color }}
                                dangerouslySetInnerHTML={{ __html: getFileIcon(node.label).svg }}
                            />
                        )}

                        <span
                            className={`${styles.name} ${statusClass}`}
                            style={isDeleted ? undefined : { color: statusColor }}
                        >
                            {node.label}
                        </span>

                        {showPath && (
                            <span className={styles.fileDirPath}>{getDirPath(node.data!.path)}</span>
                        )}
                    </>
                ) : node.data?.isAmendCommit ? (
                    <>
                        <span className={`codicon codicon-git-commit ${styles.icon}`}></span>
                        <span className={styles.name} style={{ fontStyle: 'italic' }}>{node.label}</span>
                    </>
                ) : node.data?.isRoot ? (
                    <span className={styles.name}>{node.label}</span>
                ) : (
                    <>
                        <span className={`codicon codicon-folder ${styles.icon}`}></span>
                        <span className={styles.name}>{node.label}</span>
                    </>
                )}
            </div>
        );
    }, [viewMode]);

    const getContextData = useCallback((node: TreeNode<FileNodeData>) => {
        if (!node.data?.isFile) return undefined;
        return {
            webviewSection: 'changelistFile',
            path: node.data.path,
            status: node.data.status,
            isStaged: Boolean(node.data.staged),
            isInactive: Boolean(node.data.inactive || node.id.startsWith('inactive-changes/')),
            preventDefaultContextMenuItems: true
        };
    }, []);

    // Drag: allow dragging from non-staged and non-inactive groups.
    const isDraggable = useCallback((node: TreeNode<FileNodeData>) => {
        const nodeId = node.id;
        if (nodeId.startsWith('inactive-changes/')) return false;
        if (nodeId.startsWith('staged-changes/')) return false;
        if (nodeId.startsWith('amend/')) return false;
        return nodeId.startsWith('changes/') ||
            nodeId.startsWith('untracked-changes/') ||
            nodeId.startsWith('conflicting-changes/') ||
            nodeId === '__root__changes' ||
            nodeId === '__root__untracked-changes' ||
            nodeId === '__root__conflicting-changes';
    }, []);

    // Drop: allow dropping on staged group root or any of its children.
    const isDropTarget = useCallback((node: TreeNode<FileNodeData>) => {
        return node.id === '__root__staged-changes' || node.id.startsWith('staged-changes/');
    }, []);

    // Always highlight staged root when dragging over staged children.
    const getDropTargetRootId = useCallback((node: TreeNode<FileNodeData>) => {
        if (node.id === '__root__staged-changes' || node.id.startsWith('staged-changes/')) {
            return '__root__staged-changes';
        }
        return null;
    }, []);

    // Handle drop: stage the files (git add)
    const handleDrop = useCallback((draggedNode: TreeNode<FileNodeData>, targetNode: TreeNode<FileNodeData>) => {
        logger.info(`Drop detected ${draggedNode.id} -> ${targetNode.id}`);
        const paths = getAllFilePaths(draggedNode);
        if (paths.length > 0) {
            rpc.stageFiles(paths);
        }
    }, []);

    // Provide native file drag data (text/uri-list)
    const getDragData = useCallback((node: TreeNode<FileNodeData>): Record<string, string> => {
        const paths = getAllFilePaths(node);
        if (paths.length === 0) return {};

        const root = workspaceRoot || '';

        // Calculate absolute paths and file URIs
        const absPaths = paths.map(p => root ? (root.endsWith('/') ? root + p : root + '/' + p) : p);
        const fileUris = absPaths.map(p => `file://${encodeURI(p)}`);

        const uriList = fileUris.join('\r\n');
        const plainText = absPaths.join('\n');

        return {
            'text/uri-list': uriList,
            'text/plain': plainText,
            'application/vnd.code.uri-list': uriList,
            'codefiles': JSON.stringify(absPaths),
            'resourceurls': JSON.stringify(fileUris)
        };
    }, [workspaceRoot]);

    // Get label info for drag image
    const getDragLabel = useCallback((node: TreeNode<FileNodeData>) => {
        return {
            label: node.label,
            count: node.data?.fileCount
        };
    }, []);

    return (
        <BasicTreeView
            ref={treeRef}
            nodes={nodes}
            expandedIds={expandedIds}
            onToggle={onToggle}
            defaultExpandAll={true}
            selectedId={activeFile || undefined}
            onSelect={handleNodeClick}
            onDoubleClick={handleNodeDoubleClick}
            renderLeading={renderLeading}
            renderLabel={renderLabel}
            renderTrailing={renderTrailing}
            getContextData={getContextData}
            indent={16}
            baseIndent={8}
            isDraggable={isDraggable}
            isDropTarget={isDropTarget}
            getDropTargetRootId={getDropTargetRootId}
            onDrop={handleDrop}
            getDragData={getDragData}
            getDragLabel={getDragLabel}
        />
    );
});
