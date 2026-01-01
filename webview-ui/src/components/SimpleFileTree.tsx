import React, { useMemo, useState } from 'react';
import type { FileStatus } from '@shared/messages';
import { getFileIcon } from '../lib/fileIcons';

interface SimpleFileTreeProps {
    files: FileStatus[];
    viewMode: 'tree' | 'list';
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

export const SimpleFileTree: React.FC<SimpleFileTreeProps> = ({
    files,
    viewMode
}) => {
    const tree = useMemo(() => viewMode === 'tree' ? buildTree(files) : [], [files, viewMode]);
    const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => {
        const allPaths = new Set<string>();
        const traverse = (nodes: TreeNode[]) => {
            nodes.forEach(node => {
                if (!node.isFile) {
                    allPaths.add(node.path);
                    if (node.children) traverse(node.children);
                }
            });
        };
        traverse(tree);
        return allPaths;
    });

    const toggleFolder = (path: string) => {
        setExpandedPaths(prev => {
            const next = new Set(prev);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
        });
    };

    if (viewMode === 'list') {
        return (
            <div className="file-tree-list">
                {files.map(file => (
                    <div key={file.path} className="file-item">
                        <span className="file-icon-svg" style={{ color: getFileIcon(file.path.split('/').pop() || file.path).color }} dangerouslySetInnerHTML={{ __html: getFileIcon(file.path.split('/').pop() || file.path).svg }} />
                        <span className={`name status-${file.status}`}>{file.path}</span>
                    </div>
                ))}
            </div>
        );
    }

    const renderNode = (node: TreeNode, depth: number = 0): React.ReactNode => {
        if (node.isFile) {
            return (
                <div key={node.path} className="file-item" style={{ paddingLeft: `${depth * 16}px` }}>
                    <span className="file-icon-svg" style={{ color: getFileIcon(node.name).color }} dangerouslySetInnerHTML={{ __html: getFileIcon(node.name).svg }} />
                    <span className={`name status-${node.status}`}>{node.name}</span>
                </div>
            );
        }

        const isExpanded = expandedPaths.has(node.path);

        return (
            <div key={node.path} className="file-tree-item folder">
                <div
                    className="folder-header"
                    style={{ paddingLeft: `${depth * 16}px` }}
                    onClick={() => toggleFolder(node.path)}
                >
                    <span
                        className={`codicon codicon-chevron-right icon arrow`}
                        style={{ transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.1s' }}
                    ></span>
                    <span className="codicon codicon-folder icon"></span>
                    <span className="name">{node.name}</span>
                    <span className="file-count">{node.fileCount}</span>
                </div>
                {isExpanded && (
                    <div className="folder-children">
                        {node.children?.map(child => renderNode(child, depth + 1))}
                    </div>
                )}
            </div>
        );
    };

    if (files.length === 0) {
        return <div className="empty-state">No files</div>;
    }

    return <div className="file-tree-root">{tree.map(node => renderNode(node, 0))}</div>;
};
