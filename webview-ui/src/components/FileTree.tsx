import React, { useMemo, useState } from 'react';
import type { FileStatus } from '../types';

interface FileTreeProps {
    files: FileStatus[];
    viewMode: 'tree' | 'list';
    selectedFiles: Set<string>;
    onToggleFile: (path: string, checked: boolean) => void;
    readonly?: boolean;
    initiallyExpanded?: boolean;
}

interface TreeNode {
    name: string;
    path: string;
    children?: TreeNode[];
    isFile: boolean;
    status?: string;
    items?: FileStatus[];
}

export const FileTree: React.FC<FileTreeProps> = ({ 
    files, 
    viewMode, 
    selectedFiles, 
    onToggleFile, 
    readonly = false,
    initiallyExpanded = true
}) => {
    // Ported from media/main.js buildFileTree
    const tree = useMemo(() => {
        if (viewMode === 'list') return [];
        
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
                        status: isLast ? file.status : undefined
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
        
        // Sort: Folders first, then files
        const sortNodes = (nodes: TreeNode[]) => {
            nodes.sort((a, b) => {
                 if (a.isFile === b.isFile) return a.name.localeCompare(b.name);
                 return a.isFile ? 1 : -1;
            });
            nodes.forEach(node => {
                if (node.children) sortNodes(node.children);
            });
        };
        sortNodes(root);

        return root;
    }, [files, viewMode]);

    // Track expanded state for folders
    const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

    // Initialize/Update expanded paths when tree changes
    useMemo(() => {
        if (initiallyExpanded) {
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
            setExpandedPaths(allPaths);
        } else {
            setExpandedPaths(new Set());
        }
    }, [tree, initiallyExpanded]);


    const toggleFolder = (path: string) => {
        const newExpanded = new Set(expandedPaths);
        if (newExpanded.has(path)) {
            newExpanded.delete(path);
        } else {
            newExpanded.add(path);
        }
        setExpandedPaths(newExpanded);
    };

    // Helper to get all file paths under a node
    const getAllFiles = (node: TreeNode): string[] => {
        if (node.isFile) return [node.path];
        if (!node.children) return [];
        return node.children.flatMap(getAllFiles);
    };

    const handleFolderToggle = (node: TreeNode, checked: boolean) => {
        if (readonly) return;
        const descendantFiles = getAllFiles(node);
        descendantFiles.forEach(path => onToggleFile(path, checked));
    };

    if (viewMode === 'list') {
        return (
            <div className="file-tree-list">
                {files.map(file => (
                    <div key={file.path} className="file-item">
                        {!readonly && (
                            <input 
                                type="checkbox" 
                                className="checkbox"
                                checked={selectedFiles.has(file.path)}
                                onChange={(e) => onToggleFile(file.path, e.target.checked)}
                            />
                        )}
                        <span className={`name status-${file.status}`}>{file.path}</span>
                    </div>
                ))}
            </div>
        );
    }

    const renderNode = (node: TreeNode) => {
        if (node.isFile) {
             return (
                 <div key={node.path} className="file-item" style={{ paddingLeft: '20px' }}>
                     {!readonly && (
                         <input 
                            type="checkbox" 
                            className="checkbox"
                            checked={selectedFiles.has(node.path)}
                            onChange={(e) => onToggleFile(node.path, e.target.checked)}
                         />
                     )}
                     <i className={`codicon codicon-file icon`}></i>
                     <span className={`name status-${node.status}`}>{node.name}</span>
                 </div>
             );
        }

        // Folder logic
        const isExpanded = expandedPaths.has(node.path);
        const descendantPaths = getAllFiles(node);
        const allSelected = descendantPaths.length > 0 && descendantPaths.every(p => selectedFiles.has(p));
        const partialSelected = !allSelected && descendantPaths.some(p => selectedFiles.has(p));
        
        return (
            <div key={node.path} className="file-tree-item folder">
                 <div className="folder-header" onClick={() => toggleFolder(node.path)}>
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
                    <span className="codicon codicon-folder icon" style={{ marginRight: '4px' }}></span>
                    <span className="name">{node.name}</span>
                 </div>
                 {isExpanded && (
                     <div className="folder-children" style={{ paddingLeft: '16px' }}>
                         {node.children?.map(renderNode)}
                     </div>
                 )}
            </div>
        );
    };

    return <div className="file-tree-root">{tree.map(renderNode)}</div>;
};
