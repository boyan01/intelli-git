import React, { useMemo, useCallback } from 'react';
import type { FileStatus } from '@shared/messages';
import { getFileIcon } from '../../lib/fileIcons';
import styles from './BaseFileTree.module.css';
import { BasicTreeView } from '../common/BasicTreeView';
import type { TreeNode, BasicTreeViewRef } from '../common/BasicTreeView';
// import { getDirPath, getStatusColor } from '../../utils/fileUtils'; // Removed, will define locally

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

export interface BaseFileTreeProps {
    items: FileStatus[];
    viewMode: 'tree' | 'list';
    selectedFiles?: Set<string>;
    activeFile?: string | null;
    readonly?: boolean;
    rootLabel?: string;
    isCollapsed?: boolean;
    onToggleCollapse?: () => void;
    onToggleFile?: (path: string, checked: boolean) => void;
    onFileClick?: (path: string, status?: string) => void;
    onFileDoubleClick?: (path: string, status?: string) => void;
    onFileContextMenu?: (e: React.MouseEvent, path: string, status?: string) => void;
    onFolderContextMenu?: (e: React.MouseEvent, filePaths: string[]) => void;
}

export type BaseFileTreeRef = BasicTreeViewRef;

type SelectionStatus = 'all' | 'partial' | 'none';

interface FileNodeData {
    path: string;
    isFile: boolean;
    isRoot?: boolean;
    status?: string;
    fileCount: number;
    selectedStatus?: SelectionStatus;
}

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
                        fileCount: 0
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

    return root;
};

export const BaseFileTree = React.forwardRef<BaseFileTreeRef, BaseFileTreeProps>(({
    items,
    viewMode,
    selectedFiles,
    activeFile,
    readonly = false,
    rootLabel,
    isCollapsed = false,
    onToggleCollapse,
    onToggleFile,
    onFileClick,
    onFileDoubleClick,
    onFileContextMenu,
    onFolderContextMenu
}, ref) => {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);

    const nodes = useMemo(() => {
        let result: TreeNode<FileNodeData>[];
        if (viewMode === 'list') {
            result = items
                .map(f => ({
                    id: f.path,
                    label: f.path.split('/').pop() || f.path,
                    data: {
                        path: f.path,
                        isFile: true,
                        status: f.status,
                        fileCount: 1
                    }
                }))
                .sort((a, b) => a.label.localeCompare(b.label));
        } else {
            result = buildTree(items);
        }

        if (rootLabel) {
            const totalFiles = result.reduce((sum, n) => sum + countFiles(n), 0);
            result = [{
                id: '__root__',
                label: rootLabel,
                data: {
                    path: '',
                    isFile: false,
                    isRoot: true,
                    fileCount: totalFiles
                },
                children: isCollapsed ? [] : result
            }];
        }
        return result;
    }, [items, viewMode, rootLabel, isCollapsed]);

    React.useLayoutEffect(() => {
        computeSelection(nodes, selectedFiles);
        forceUpdate();
    }, [nodes, selectedFiles]);


    const handleNodeClick = useCallback((node: TreeNode<FileNodeData>) => {
        if (node.data?.isRoot) {
            onToggleCollapse?.();
            return;
        }
        if (node.data?.isFile) {
            onFileClick?.(node.data.path, node.data.status);
        }
    }, [onFileClick, onToggleCollapse]);

    const handleNodeDoubleClick = useCallback((node: TreeNode<FileNodeData>) => {
        if (node.data?.isFile) {
            onFileDoubleClick?.(node.data.path, node.data.status);
        }
    }, [onFileDoubleClick]);

    const handleContextMenu = useCallback((e: React.MouseEvent, node: TreeNode<FileNodeData>) => {
        if (node.data?.isFile) {
            onFileContextMenu?.(e, node.data.path, node.data.status);
        } else {
            const descendantPaths = getAllFilePaths(node);
            onFolderContextMenu?.(e, descendantPaths);
        }
    }, [onFileContextMenu, onFolderContextMenu]);

    const handleToggleFile = useCallback((node: TreeNode<FileNodeData>, checked: boolean) => {
        if (readonly || !onToggleFile) return;
        const paths = getAllFilePaths(node);
        paths.forEach(path => onToggleFile(path, checked));
    }, [readonly, onToggleFile]);

    const renderLeading = useCallback((node: TreeNode<FileNodeData>) => {
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
        if (!node.data?.isFile && node.data?.fileCount !== undefined) {
            return (
                <span className={styles.fileCount} style={{ marginLeft: 0 }}>
                    {node.data.fileCount}
                </span>
            );
        }
        return null;
    }, []);

    const renderLabel = useCallback((node: TreeNode<FileNodeData>) => {
        const isFile = node.data?.isFile;
        const status = node.data?.status;
        const isDeleted = status === 'D';
        const statusColor = getStatusColor(status);

        const statusClass = status === 'M' ? styles.statusM :
            status === 'A' ? styles.statusA :
                status === 'D' ? styles.statusD :
                    status === 'R' ? styles.statusR :
                        status === '?' ? styles.statusUntracked :
                            status === '!' ? styles.statusIgnored : '';

        const showPath = viewMode === 'list' && isFile;

        return (
            <div className={styles.fileItemContent}>
                {isFile ? (
                    <>
                        {/* Conflict warning or file icon */}
                        {(status === 'C' || status === 'U') ? (
                            <span className={`codicon codicon-warning ${styles.icon}`} style={{ color: statusColor }}></span>
                        ) : (
                            <span
                                className={styles.fileIconSvg}
                                style={{ color: getFileIcon(node.label).color }}
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

    return (
        <BasicTreeView
            ref={ref}
            nodes={nodes}
            defaultExpandAll={true}
            selectedId={activeFile || undefined}
            onSelect={handleNodeClick}
            onDoubleClick={handleNodeDoubleClick}
            onContextMenu={handleContextMenu}
            renderLeading={renderLeading}
            renderLabel={renderLabel}
            renderTrailing={renderTrailing}
            indent={16}
            baseIndent={8}
        />
    );
});
