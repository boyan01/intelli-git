import React, { useMemo, useCallback } from 'react';
import type { FileStatus } from '@shared/messages';
import { rpc } from '../../lib/rpc_client';
import { getFileIcon } from '../../lib/fileIcons';
import styles from './FileTree.module.css';
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
    onToggleFile?: (path: string, checked: boolean) => void;
    onFileClick?: (path: string, status?: string) => void;
    onFileDoubleClick?: (path: string, status?: string) => void;
    onFileContextMenu?: (e: React.MouseEvent, path: string, status?: string) => void;
    onFolderContextMenu?: (e: React.MouseEvent, filePaths: string[]) => void;
}

export type BaseFileTreeRef = BasicTreeViewRef;

// Custom data attached to each tree node
interface FileNodeData {
    path: string;
    isFile: boolean;
    status?: string;
    fileCount: number;
}

const countFiles = (node: TreeNode<FileNodeData>): number => {
    if (node.data?.isFile) return 1;
    if (!node.children) return 0;
    return node.children.reduce((sum, child) => sum + countFiles(child), 0);
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
    onToggleFile,
    onFileClick,
    onFileDoubleClick,
    onFileContextMenu,
    onFolderContextMenu
}, ref) => {
    const nodes = useMemo(() => {
        if (viewMode === 'list') {
            return items
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
        }
        return buildTree(items);
    }, [items, viewMode]);

    const getAllFilePaths = useCallback((node: TreeNode<FileNodeData>): string[] => {
        if (node.data?.isFile) return [node.data.path];
        if (!node.children) return [];
        return node.children.flatMap(getAllFilePaths);
    }, []);

    const handleNodeClick = useCallback((node: TreeNode<FileNodeData>) => {
        if (node.data?.isFile) {
            if (onFileClick) {
                onFileClick(node.data.path, node.data.status);
            } else {
                rpc.openFile({ path: node.data.path });
            }
        }
    }, [onFileClick]);

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
    }, [onFileContextMenu, onFolderContextMenu, getAllFilePaths]);

    const handleToggleFile = useCallback((node: TreeNode<FileNodeData>, checked: boolean) => {
        if (readonly || !onToggleFile) return;
        const paths = getAllFilePaths(node);
        paths.forEach(path => onToggleFile(path, checked));
    }, [readonly, onToggleFile, getAllFilePaths]);

    const renderLeading = useCallback((node: TreeNode<FileNodeData>) => {
        if (readonly || !onToggleFile) return null;

        const descendantPaths = getAllFilePaths(node);
        // Optimize: if it's a file, just check deeply. If folder, check all descendants.
        // Actually, for a single node, getAllFilePaths returns itself if it's a file.

        const allSelected = selectedFiles && descendantPaths.length > 0 && descendantPaths.every(p => selectedFiles.has(p));
        const partialSelected = selectedFiles && !allSelected && descendantPaths.some(p => selectedFiles.has(p));

        return (
            <input
                type="checkbox"
                className={styles.checkbox}
                checked={allSelected ?? false}
                ref={input => { if (input) input.indeterminate = partialSelected ?? false; }}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => handleToggleFile(node, e.target.checked)}
            />
        );
    }, [readonly, onToggleFile, selectedFiles, getAllFilePaths, handleToggleFile]);

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
            baseIndent={viewMode === 'list' ? 12 : 8}
        />
    );
});
