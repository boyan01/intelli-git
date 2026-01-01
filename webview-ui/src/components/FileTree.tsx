import React, { useMemo, useState, useCallback } from 'react';
import type { FileStatus, ChangelistGroup } from '@shared/messages';
import { getFileIcon } from '../lib/fileIcons';

interface FileTreeProps {
    changelists: ChangelistGroup[];
    viewMode: 'tree' | 'list';
    selectedFiles: Set<string>;
    collapsedGroups: Set<string>;
    onToggleFile: (path: string, checked: boolean) => void;
    onToggleGroup: (groupId: string) => void;
    readonly?: boolean;
}

interface TreeNode {
    name: string;
    path: string;
    fullPath: string;
    children?: TreeNode[];
    isFile: boolean;
    status?: string;
    fileCount: number;
}

// Count files under a node
const countFiles = (node: TreeNode): number => {
    if (node.isFile) return 1;
    if (!node.children) return 0;
    return node.children.reduce((sum, child) => sum + countFiles(child), 0);
};

// Build tree structure from flat file list
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
                    fullPath: file.path,
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

    // Sort and calculate file counts
    const processNodes = (nodes: TreeNode[]) => {
        nodes.sort((a, b) => {
            if (a.isFile === b.isFile) return a.name.localeCompare(b.name);
            return a.isFile ? 1 : -1;
        });
        nodes.forEach(node => {
            if (node.children) {
                processNodes(node.children);
            }
            node.fileCount = countFiles(node);
        });
    };
    processNodes(root);

    return root;
};

// Get directory path from full path
const getDirPath = (fullPath: string): string => {
    const lastSlash = fullPath.lastIndexOf('/');
    return lastSlash > 0 ? fullPath.substring(0, lastSlash) : '';
};

export const FileTree: React.FC<FileTreeProps> = ({
    changelists,
    viewMode,
    selectedFiles,
    collapsedGroups,
    onToggleFile,
    onToggleGroup,
    readonly = false
}) => {
    const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

    // Build trees for each changelist
    const changelistTrees = useMemo(() => {
        return changelists.map(group => ({
            group,
            tree: viewMode === 'tree' ? buildTree(group.items) : []
        }));
    }, [changelists, viewMode]);

    // Initialize expanded state
    useMemo(() => {
        const allPaths = new Set<string>();
        changelistTrees.forEach(({ tree }) => {
            const traverse = (nodes: TreeNode[]) => {
                nodes.forEach(node => {
                    if (!node.isFile) {
                        allPaths.add(node.path);
                        if (node.children) traverse(node.children);
                    }
                });
            };
            traverse(tree);
        });
        setExpandedPaths(allPaths);
    }, [changelistTrees]);

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
        if (readonly) return;
        getAllFilePaths(node).forEach(path => onToggleFile(path, checked));
    }, [readonly, getAllFilePaths, onToggleFile]);

    const handleGroupToggle = useCallback((files: FileStatus[], checked: boolean) => {
        if (readonly) return;
        files.forEach(f => onToggleFile(f.path, checked));
    }, [readonly, onToggleFile]);

    const renderFileItem = (file: FileStatus, showPath: boolean) => (
        <div key={file.path} className="file-item">
            {!readonly && (
                <input
                    type="checkbox"
                    className="checkbox"
                    checked={selectedFiles.has(file.path)}
                    onChange={(e) => onToggleFile(file.path, e.target.checked)}
                />
            )}
            <span className="file-icon-svg" style={{ color: getFileIcon(file.path.split('/').pop() || file.path).color }} dangerouslySetInnerHTML={{ __html: getFileIcon(file.path.split('/').pop() || file.path).svg }} />
            <span className={`name status-${file.status}`}>
                {file.path.split('/').pop()}
            </span>
            {showPath && (
                <span className="file-dir-path">{getDirPath(file.path)}</span>
            )}
        </div>
    );

    const renderTreeNode = (node: TreeNode, depth: number = 0): React.ReactNode => {
        if (node.isFile) {
            return (
                <div key={node.path} className="file-item" style={{ paddingLeft: `${depth * 16}px` }}>
                    {!readonly && (
                        <input
                            type="checkbox"
                            className="checkbox"
                            checked={selectedFiles.has(node.path)}
                            onChange={(e) => onToggleFile(node.path, e.target.checked)}
                        />
                    )}
                    <span className="file-icon-svg" style={{ color: getFileIcon(node.name).color }} dangerouslySetInnerHTML={{ __html: getFileIcon(node.name).svg }} />
                    <span className={`name status-${node.status}`}>{node.name}</span>
                </div>
            );
        }

        const isExpanded = expandedPaths.has(node.path);
        const descendantPaths = getAllFilePaths(node);
        const allSelected = descendantPaths.length > 0 && descendantPaths.every(p => selectedFiles.has(p));
        const partialSelected = !allSelected && descendantPaths.some(p => selectedFiles.has(p));

        return (
            <div key={node.path} className="file-tree-item folder">
                <div
                    className="folder-header"
                    style={{ paddingLeft: `${depth * 16}px` }}
                    onClick={() => toggleFolder(node.path)}
                >
                    {!readonly && (
                        <input
                            type="checkbox"
                            className="checkbox"
                            checked={allSelected}
                            ref={input => { if (input) input.indeterminate = partialSelected; }}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => handleFolderToggle(node, e.target.checked)}
                        />
                    )}
                    <span
                        className={`codicon codicon-chevron-right icon arrow ${isExpanded ? 'expanded' : ''}`}
                        style={{ transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.1s' }}
                    ></span>
                    <span className="codicon codicon-folder icon"></span>
                    <span className="name">{node.name}</span>
                    <span className="file-count">{node.fileCount}</span>
                </div>
                {isExpanded && (
                    <div className="folder-children">
                        {node.children?.map(child => renderTreeNode(child, depth + 1))}
                    </div>
                )}
            </div>
        );
    };

    const renderChangelist = ({ group, tree }: { group: ChangelistGroup; tree: TreeNode[] }) => {
        const isCollapsed = collapsedGroups.has(group.id);
        const allSelected = group.items.length > 0 && group.items.every(f => selectedFiles.has(f.path));
        const partialSelected = !allSelected && group.items.some(f => selectedFiles.has(f.path));

        return (
            <div key={group.id} className="file-tree-item changelist">
                <div
                    className={`file-group-header ${isCollapsed ? 'collapsed' : ''}`}
                    onClick={() => onToggleGroup(group.id)}
                >
                    {!readonly && (
                        <input
                            type="checkbox"
                            className="checkbox"
                            checked={allSelected}
                            ref={input => { if (input) input.indeterminate = partialSelected; }}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => handleGroupToggle(group.items, e.target.checked)}
                        />
                    )}
                    <span
                        className={`codicon codicon-chevron-right icon arrow`}
                        style={{ transform: isCollapsed ? 'none' : 'rotate(90deg)', transition: 'transform 0.1s' }}
                    ></span>
                    <span className="title">{group.name}</span>
                    <span className="file-count">{group.items.length}</span>
                </div>
                {!isCollapsed && (
                    <div className="changelist-content">
                        {viewMode === 'tree'
                            ? tree.map(node => renderTreeNode(node, 1))
                            : group.items.map(file => renderFileItem(file, true))
                        }
                    </div>
                )}
            </div>
        );
    };

    if (changelists.length === 0) {
        return <div className="empty-state">没有更改</div>;
    }

    return (
        <div className="file-tree-root">
            {changelistTrees.map(renderChangelist)}
        </div>
    );
};
