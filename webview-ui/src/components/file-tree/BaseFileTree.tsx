import React, { useMemo, useState, useCallback } from 'react';
import type { FileStatus } from '@shared/messages';
import { vscode } from '../../lib/vscode';
import { getFileIcon } from '../../lib/fileIcons';
import styles from './FileTree.module.css';

export interface BaseFileTreeProps {
    items: FileStatus[];
    viewMode: 'tree' | 'list';
    selectedFiles?: Set<string>;
    activeFile?: string | null;
    readonly?: boolean;
    onToggleFile?: (path: string, checked: boolean) => void;
    onFileClick?: (path: string, status?: string) => void;
    onFileContextMenu?: (e: React.MouseEvent, path: string, status?: string) => void;
    onFolderContextMenu?: (e: React.MouseEvent, filePaths: string[]) => void;
}

export interface BaseFileTreeRef {
    expandAll: () => void;
    collapseAll: () => void;
}

interface TreeNode {
    name: string;
    path: string;
    children?: TreeNode[];
    isFile: boolean;
    status?: string;
    fileCount: number;
}

const countFiles = (node: TreeNode): number => {
    if (node.isFile) return 1;
    if (!node.children) return 0;
    return node.children.reduce((sum, child) => sum + countFiles(child), 0);
};

const buildTree = (files: FileStatus[]): TreeNode[] => {
    const root: TreeNode[] = [];
    const map = new Map<string, TreeNode>();

    files.forEach(file => {
        const parts = file.path.split('/');
        let currentPath = '';

        parts.forEach((part, index) => {
            const isLast = index === parts.length - 1;
            const parentPath = currentPath;
            currentPath = currentPath ? `${currentPath}/${part}` : part;

            if (!map.has(currentPath)) {
                const node: TreeNode = {
                    name: part,
                    path: currentPath,
                    isFile: isLast,
                    children: isLast ? undefined : [],
                    status: isLast ? file.status : undefined,
                    fileCount: 0
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

    const processNodes = (nodes: TreeNode[]) => {
        nodes.sort((a, b) => {
            if (a.isFile === b.isFile) return a.name.localeCompare(b.name);
            return a.isFile ? 1 : -1;
        });
        nodes.forEach(node => {
            if (node.children) processNodes(node.children);
            node.fileCount = countFiles(node);
        });
    };
    processNodes(root);

    return root;
};

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

export const BaseFileTree = React.forwardRef<BaseFileTreeRef, BaseFileTreeProps>(({
    items,
    viewMode,
    selectedFiles,
    activeFile,
    readonly = false,
    onToggleFile,
    onFileClick,
    onFileContextMenu,
    onFolderContextMenu
}, ref) => {
    const tree = useMemo(() =>
        viewMode === 'tree' ? buildTree(items) : [],
        [items, viewMode]
    );

    const getAllFolderPaths = useCallback((nodes: TreeNode[]): Set<string> => {
        const paths = new Set<string>();
        const traverse = (currentNodes: TreeNode[]) => {
            currentNodes.forEach(node => {
                if (!node.isFile) {
                    paths.add(node.path);
                    if (node.children) traverse(node.children);
                }
            });
        };
        traverse(nodes);
        return paths;
    }, []);

    const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() =>
        getAllFolderPaths(tree)
    );

    React.useImperativeHandle(ref, () => ({
        expandAll: () => {
            setExpandedPaths(getAllFolderPaths(tree));
        },
        collapseAll: () => {
            setExpandedPaths(new Set());
        }
    }));

    const toggleFolder = useCallback((path: string) => {
        setExpandedPaths(prev => {
            const next = new Set(prev);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
        });
    }, []);

    const getAllFilePaths = useCallback((node: TreeNode): string[] => {
        if (node.isFile) return [node.path];
        if (!node.children) return [];
        return node.children.flatMap(getAllFilePaths);
    }, []);

    const handleFolderToggle = useCallback((node: TreeNode, checked: boolean) => {
        if (readonly || !onToggleFile) return;
        getAllFilePaths(node).forEach(path => onToggleFile(path, checked));
    }, [readonly, getAllFilePaths, onToggleFile]);

    const handleFileClick = useCallback((path: string, status?: string) => {
        if (onFileClick) {
            onFileClick(path, status);
        } else {
            vscode.postMessage({ type: 'openFile', path, status });
        }
    }, [onFileClick]);

    const renderTreeNode = (node: TreeNode, depth: number = 0): React.ReactNode => {
        if (node.isFile) {
            const showPath = viewMode === 'list';
            const isActive = node.path === activeFile;
            const isConflict = node.status === 'C' || node.status === 'U';
            const isDeleted = node.status === 'D';
            const statusColor = getStatusColor(node.status);

            const statusClass = node.status === 'M' ? styles.statusM :
                node.status === 'A' ? styles.statusA :
                    node.status === 'D' ? styles.statusD :
                        node.status === 'R' ? styles.statusR :
                            node.status === '?' ? styles.statusUntracked :
                                node.status === '!' ? styles.statusIgnored : '';

            return (
                <div
                    key={node.path}
                    className={`${styles.fileItem} ${isActive ? styles.active : ''}`}
                    style={{ paddingLeft: `${28 + depth * 16}px` }}
                    onClick={() => handleFileClick(node.path, node.status)}
                    onContextMenu={(e) => onFileContextMenu?.(e, node.path, node.status)}
                >
                    {!readonly && onToggleFile && (
                        <input
                            type="checkbox"
                            className={styles.checkbox}
                            checked={selectedFiles?.has(node.path) ?? false}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => onToggleFile(node.path, e.target.checked)}
                        />
                    )}
                    {isConflict ? (
                        <span className={`codicon codicon-warning ${styles.icon}`} style={{ color: statusColor }}></span>
                    ) : (
                        <span
                            className={styles.fileIconSvg}
                            style={{ color: getFileIcon(node.name).color }}
                            dangerouslySetInnerHTML={{ __html: getFileIcon(node.name).svg }}
                        />
                    )}
                    <span
                        className={`${styles.name} ${statusClass}`}
                        style={isDeleted ? undefined : { color: statusColor }}
                    >
                        {node.name}
                    </span>
                    {showPath && (
                        <span className={styles.fileDirPath}>{getDirPath(node.path)}</span>
                    )}
                </div>
            );
        }

        const isExpanded = expandedPaths.has(node.path);
        const descendantPaths = getAllFilePaths(node);
        const allSelected = selectedFiles && descendantPaths.length > 0 && descendantPaths.every(p => selectedFiles.has(p));
        const partialSelected = selectedFiles && !allSelected && descendantPaths.some(p => selectedFiles.has(p));

        return (
            <div key={node.path} className={`${styles.folderItem} ${styles.folder}`}>
                <div
                    className={styles.folderHeader}
                    style={{ paddingLeft: `${8 + depth * 16}px` }}
                    onClick={() => toggleFolder(node.path)}
                    onContextMenu={(e) => onFolderContextMenu?.(e, descendantPaths)}
                >
                    <span
                        className={`codicon codicon-chevron-right ${styles.icon} ${styles.arrow}`}
                        style={{ transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.1s' }}
                    ></span>
                    {!readonly && onToggleFile && descendantPaths.length > 0 && (
                        <input
                            type="checkbox"
                            className={styles.checkbox}
                            checked={allSelected ?? false}
                            ref={input => { if (input) input.indeterminate = partialSelected ?? false; }}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => handleFolderToggle(node, e.target.checked)}
                        />
                    )}
                    <span className={`codicon codicon-folder ${styles.icon}`}></span>
                    <span className={styles.name}>{node.name}</span>
                    <span className={styles.fileCount}>{node.fileCount}</span>
                </div>
                {isExpanded && (
                    <div className={styles.folderChildren}>
                        {node.children?.map(child => renderTreeNode(child, depth + 1))}
                    </div>
                )}
            </div>
        );
    };

    // List mode: flat rendering
    if (viewMode === 'list') {
        const flatNodes: TreeNode[] = items
            .map(f => ({
                name: f.path.split('/').pop() || f.path,
                path: f.path,
                isFile: true,
                status: f.status,
                fileCount: 1
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

        return (
            <div className={styles.fileTreeRoot}>
                {flatNodes.map(node => renderTreeNode(node, 0))}
            </div>
        );
    }

    // Tree mode: hierarchical rendering with multiple top-level nodes
    return (
        <div className={styles.fileTreeRoot}>
            {tree.map(node => renderTreeNode(node, 0))}
        </div>
    );
});
