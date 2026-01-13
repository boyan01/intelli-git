import React, { useMemo, useCallback, useRef } from 'react';
import type { ChangelistGroup, FileStatus } from '@shared/messages';
import { BasicTreeView } from '../common/BasicTreeView';
import type { TreeNode, BasicTreeViewRef } from '../common/BasicTreeView';
import { getFileIcon } from '../../lib/fileIcons';
import { rpc } from '@/lib/rpc_client';
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
    status?: string;
    fileCount: number;
    selectedStatus?: SelectionStatus;
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

export const ChangelistTree = React.forwardRef<ChangelistTreeRef, ChangelistTreeProps>(({
    groups,
    viewMode,
    selectedFiles,
    expandedIds,
    activeFile,
    onToggle,
    onToggleFile,
    readonly = false
}, ref) => {
    const treeRef = useRef<BasicTreeViewRef>(null);
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);

    React.useImperativeHandle(ref, () => ({
        expandAll: () => treeRef.current?.expandAll(),
        collapseAll: () => treeRef.current?.collapseAll()
    }));

    const nodes = useMemo(() => {
        return groups.map(group => {
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
                            fileCount: 1
                        }
                    }))
                    .sort((a, b) => a.label.localeCompare(b.label));
            } else {
                children = buildTree(group.items).map(node => ({
                    ...node,
                    id: `${group.id}/${node.id}`
                }));
            }

            const totalFiles = children.reduce((sum, n) => sum + countFiles(n), 0);
            return {
                id: `__root__${group.id}`,
                label: group.name,
                data: {
                    path: '',
                    isFile: false,
                    isRoot: true,
                    fileCount: totalFiles
                },
                children
            } as TreeNode<FileNodeData>;
        });
    }, [groups, viewMode]);

    React.useLayoutEffect(() => {
        computeSelection(nodes, selectedFiles);
        forceUpdate();
    }, [nodes, selectedFiles]);

    const handleNodeClick = useCallback((node: TreeNode<FileNodeData>) => {
        if (node.data?.isFile) {
            rpc.openFile({ path: node.data.path, preserveFocus: true });
        }
    }, []);

    const handleNodeDoubleClick = useCallback((node: TreeNode<FileNodeData>) => {
        if (node.data?.isFile) {
            rpc.openFile({ path: node.data.path, preserveFocus: false });
        }
    }, []);

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

    const getContextData = useCallback((node: TreeNode<FileNodeData>) => {
        if (!node.data?.isFile) return undefined;
        return {
            webviewSection: 'changelistFile',
            path: node.data.path,
            status: node.data.status,
            preventDefaultContextMenuItems: true
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
        />
    );
});
