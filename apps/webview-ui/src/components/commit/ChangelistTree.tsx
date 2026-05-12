import React, { useMemo, useCallback, useRef } from 'react';
import type { ChangelistGroup, ChangelistState, FileStatus, LastCommitInfo } from '@shared/messages';
import type { ChangelistBackgroundContext, ChangelistFileContext, ChangelistFolderContext, ChangelistRootContext } from '@shared/webviewContext';
import { useTranslation } from 'react-i18next';
import { BasicTreeView } from '../common/BasicTreeView';
import type { TreeNode, BasicTreeViewRef } from '../common/BasicTreeView';
import { getFileIcon } from '../../lib/fileIcons';
import { rpc, rpcEvents } from '@/lib/rpc_client';
import { logger } from '@/utils/logger';
import styles from '../file-tree/BaseFileTree.module.css';
import { compactSingleChildFolders } from '../file-tree/treeUtils';

export interface ChangelistTreeProps {
    groups: ChangelistGroup[];
    changelistState: ChangelistState;
    viewMode: 'tree' | 'list';
    selectedFiles: Set<string>;
    expandedIds?: Set<string>;
    activeFile?: string | null;
    onToggle?: (id: string, expanded: boolean) => void;
    readonly?: boolean;
    workspaceRoot?: string;
    amendCommit?: LastCommitInfo | null;
}

export interface ChangelistTreeRef {
    expandAll: () => void;
    collapseAll: () => void;
}

interface FileNodeData {
    path: string;
    isFile: boolean;
    hunkIds?: string[];
    isRoot?: boolean;
    isInactiveGroup?: boolean;
    isStagedGroup?: boolean;
    status?: string;
    staged?: boolean;
    inactive?: boolean;
    resolvedCandidate?: boolean;
    fileCount: number;
    hasWarning?: boolean;
    isAmendCommit?: boolean;
    isAmendFile?: boolean;
    changelistId?: string;
    isActiveChangelist?: boolean;
    isChangelistGroup?: boolean;
    showInDragMode?: boolean;
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
                        path: file.path,
                        isFile: isLast,
                        status: isLast ? file.status : undefined,
                        staged: isLast ? file.staged : undefined,
                        inactive: isLast ? file.inactive : undefined,
                        hunkIds: isLast && file.status !== '?' ? file.hunks?.map(hunk => hunk.id) : undefined,
                        resolvedCandidate: isLast ? file.resolvedCandidate : undefined,
                        fileCount: 0
                    },
                    children: isLast ? [] : []
                };

                map.set(currentPath, node);

                if (index === 0) {
                    root.push(node);
                } else {
                    map.get(parentPath)?.children?.push(node);
                }
            }
        });

        const fileNode = map.get(file.path);
        if (fileNode) {
            fileNode.children = undefined;
        }
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
    return compactSingleChildFolders(root);
};

const prefixNodes = (nodes: TreeNode<FileNodeData>[], prefix: string, listId?: string): TreeNode<FileNodeData>[] => {
    return nodes.map(node => ({
        ...node,
        id: `${prefix}/${node.id}`,
        data: node.data ? {
            ...node.data,
            changelistId: listId
        } : undefined,
        children: node.children ? prefixNodes(node.children, prefix, listId) : undefined
    }));
};

function getAllMoveData(node: TreeNode<FileNodeData>): { paths: string[]; hunkMap: Record<string, string[]> } {
    if (node.data?.isFile) {
        if (node.data.hunkIds && node.data.hunkIds.length > 0) {
            return {
                paths: [],
                hunkMap: { [node.data.path]: node.data.hunkIds }
            };
        }

        return {
            paths: [node.data.path],
            hunkMap: {}
        };
    }

    const paths = new Set<string>();
    const hunkMap: Record<string, string[]> = {};
    node.children?.forEach(child => {
        const childData = getAllMoveData(child);
        childData.paths.forEach(path => paths.add(path));
        Object.entries(childData.hunkMap).forEach(([path, hunkIds]) => {
            hunkMap[path] = [...(hunkMap[path] || []), ...hunkIds];
        });
    });

    return {
        paths: Array.from(paths),
        hunkMap
    };
}

function getDescendantFiles(node: TreeNode<FileNodeData>): FileNodeData[] {
    if (node.data?.isFile) {
        return node.data.path ? [node.data] : [];
    }

    return (node.children || []).flatMap(child => getDescendantFiles(child));
}

export const ChangelistTree = React.forwardRef<ChangelistTreeRef, ChangelistTreeProps>(({
    groups,
    changelistState,
    viewMode,
    expandedIds,
    activeFile,
    onToggle,
    workspaceRoot,
    amendCommit
}, ref) => {
    const { t } = useTranslation();
    const treeRef = useRef<BasicTreeViewRef>(null);

    React.useImperativeHandle(ref, () => ({
        expandAll: () => treeRef.current?.expandAll(),
        collapseAll: () => treeRef.current?.collapseAll()
    }));

    const nodes = useMemo(() => {
        const result: TreeNode<FileNodeData>[] = [];

        groups.forEach(group => {
            const listInfo = changelistState.lists.find(list => list.id === group.id);
            const children = viewMode === 'list'
                ? group.items.map(file => ({
                    id: `${group.id}/${file.path}`,
                    label: file.path.split('/').pop() || file.path,
                    data: {
                        path: file.path,
                        isFile: true,
                        status: file.status,
                        staged: file.staged,
                        inactive: file.inactive,
                        hunkIds: file.status !== '?' ? file.hunks?.map(hunk => hunk.id) : undefined,
                        resolvedCandidate: file.resolvedCandidate,
                        fileCount: 1,
                        changelistId: group.id
                    },
                    children: undefined
                }))
                : prefixNodes(buildTree(group.items), group.id, group.id);

            result.push({
                id: `__root__${group.id}`,
                label: group.name,
                data: {
                    path: '',
                    isFile: false,
                    isRoot: true,
                    isInactiveGroup: group.id === 'inactive-changes',
                    isStagedGroup: group.id === 'staged-changes',
                    fileCount: group.items.length,
                    hasWarning: group.hasWarning,
                    changelistId: group.id,
                    isActiveChangelist: group.isActive,
                    isChangelistGroup: Boolean(listInfo),
                    showInDragMode: group.items.length === 0 && (
                        group.id === 'staged-changes' ||
                        group.id === 'changes' ||
                        group.id === 'inactive-changes'
                    )
                },
                children
            });
        });

        if (amendCommit) {
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
                children: amendCommit.files.map(file => ({
                    id: `amend/${file.path}`,
                    label: file.path.split('/').pop() || file.path,
                    data: {
                        path: file.path,
                        isFile: true,
                        isAmendFile: true,
                        status: file.status,
                        fileCount: 1
                    }
                }))
            });
        }

        return result;
    }, [groups, changelistState.lists, viewMode, amendCommit]);

    const handleNodeClick = useCallback((node: TreeNode<FileNodeData>) => {
        if (node.data?.isFile) {
            if (node.data.status === 'D') {
                rpc.openDiff(node.data.path, node.data.staged);
            } else {
                rpc.openFile({ path: node.data.path, preserveFocus: true });
            }
        }
    }, []);

    const handleNodeDoubleClick = useCallback((node: TreeNode<FileNodeData>) => {
        if (node.data?.isFile) {
            if (node.data.status === 'D') {
                rpc.openDiff(node.data.path, node.data.staged);
            } else {
                rpc.openFile({ path: node.data.path, preserveFocus: false });
            }
        }
    }, []);

    const handleFocusNodeChange = useCallback((node: TreeNode<FileNodeData>) => {
        if (!node.data?.isFile) {
            void rpc.setActiveChangelistFile(null);
            return;
        }

        void rpc.setActiveChangelistFile({
            path: node.data.path,
            status: node.data.status,
            staged: node.data.staged,
            inactive: node.data.inactive,
            isConflict: node.data.status === 'C' || node.data.status === 'U'
        });
    }, []);

    const renderTrailing = useCallback((node: TreeNode<FileNodeData>) => {
        if (node.data?.isRoot && node.data.isChangelistGroup && changelistState.mode === 'changes') {
            return null;
        }

        if (node.data?.isAmendCommit || node.data?.isAmendFile) {
            return null;
        }

        if (changelistState.mode === 'changes') {
            return null;
        }

        const fileNodes = getDescendantFiles(node);
        const actionableFileNodes = fileNodes.filter(file => !file.inactive);
        if (actionableFileNodes.length === 0) {
            return null;
        }

        const isAllStaged = actionableFileNodes.every(file => file.staged);
        const action = isAllStaged ? {
            kind: 'unstage' as const,
            title: t('Unstage')
        } : {
            kind: 'stage' as const,
            title: t('Stage')
        };
        const paths = Array.from(new Set(actionableFileNodes.map(file => file.path)));

        return (
            <div className={styles.groupTrailing}>
                <button
                    type="button"
                    className={styles.hoverAction}
                    title={action.title}
                    onClick={async (event) => {
                        event.stopPropagation();
                        if (action.kind === 'stage') {
                            await rpc.stageFiles(paths);
                        } else {
                            await rpc.unstageFiles(paths);
                        }
                        rpcEvents.refresh.emit();
                    }}
                >
                    <i className={`codicon ${action.kind === 'stage' ? 'codicon-add' : 'codicon-remove'}`} />
                </button>
            </div>
        );
    }, [changelistState, t]);

    const renderLabel = useCallback((node: TreeNode<FileNodeData>) => {
        const status = node.data?.status;
        const statusColor = getStatusColor(status);
        const isDeleted = status === 'D';
        const isAmendFile = node.data?.isAmendFile;
        const showPath = viewMode === 'list' && (node.data?.isFile || isAmendFile);

        if (node.data?.isAmendCommit) {
            return (
                <div className={styles.fileItemContent}>
                    <span className={`codicon codicon-git-commit ${styles.icon}`}></span>
                    <span className={styles.name} style={{ fontStyle: 'italic' }}>{node.label}</span>
                </div>
            );
        }

        if (node.data?.isRoot) {
            return (
                <div className={styles.rootTitleGroup}>
                    <span className={styles.rootTitle} style={node.data.isActiveChangelist ? { fontWeight: 700 } : undefined}>{node.label}</span>
                    <span
                        className={styles.fileCount}
                    >{node.data.fileCount}</span>
                    {node.data.hasWarning && (
                        <span
                            className={`codicon codicon-warning ${styles.icon}`}
                            style={{ color: 'var(--vscode-notificationsWarningIcon-foreground)', marginLeft: '4px' }}
                            title={t('Some inactive changes in this group are staged externally. They will be automatically excluded by the plugin during commit.')}
                        ></span>
                    )}
                </div>
            );
        }

        if (node.data?.isFile) {
            const fileIcon = getFileIcon(node.label);
            const statusClass = status === 'M' ? styles.statusM :
                status === 'A' ? styles.statusA :
                    status === 'D' ? styles.statusD :
                        status === 'R' ? styles.statusR :
                            status === '?' ? styles.statusUntracked :
                                '';

            return (
                <div className={styles.fileItemContent} data-drag-label="true">
                    <span
                        className={styles.fileIconSvg}
                        style={{ color: statusColor || fileIcon.color }}
                        dangerouslySetInnerHTML={{ __html: fileIcon.svg }}
                    />
                    <span className={`${styles.name} ${statusClass}`} style={isDeleted ? undefined : { color: statusColor }}>
                        {node.label}
                    </span>
                    {showPath && <span className={styles.fileDirPath}>{getDirPath(node.data.path)}</span>}
                </div>
            );
        }

        return (
            <div className={styles.fileItemContent}>
                <span className={`codicon codicon-folder ${styles.icon}`}></span>
                <span className={styles.name}>{node.label}</span>
            </div>
        );
    }, [t, viewMode]);

    const getContextData = useCallback((node: TreeNode<FileNodeData>) => {
        const descendantFiles = getDescendantFiles(node);
        const paths = Array.from(new Set(descendantFiles.map(file => file.path)));
        const hasConflict = descendantFiles.some(file => file.status === 'C' || file.status === 'U');
        const hasInactive = descendantFiles.some(file => Boolean(file.inactive));
        const allInactive = descendantFiles.length > 0 && descendantFiles.every(file => Boolean(file.inactive));
        const hasStaged = descendantFiles.some(file => Boolean(file.staged));
        const allStaged = descendantFiles.length > 0 && descendantFiles.every(file => Boolean(file.staged));
        const hasUntracked = descendantFiles.some(file => file.status === '?');

        if (!node.data?.isFile) {
            if (node.data?.isRoot) {
                const changelist = changelistState.lists.find(list => list.id === node.data?.changelistId);
                return {
                    webviewSection: 'changelistRoot',
                    changelistId: node.data.changelistId,
                    paths,
                    isActiveChangelist: Boolean(node.data.isActiveChangelist),
                    canSetActiveChangelist: Boolean(changelist && !node.data.isActiveChangelist && node.data.changelistId !== 'inactive-changes'),
                    canDeleteChangelist: Boolean(changelist && !changelist.isDefault),
                    hasConflict,
                    hasInactive,
                    allInactive,
                    hasStaged,
                    allStaged,
                    hasUntracked,
                    changelistMode: changelistState.mode,
                    preventDefaultContextMenuItems: true
                } satisfies ChangelistRootContext;
            }

            return {
                webviewSection: 'changelistFolder',
                path: node.id,
                paths,
                hasConflict,
                hasInactive,
                allInactive,
                hasStaged,
                allStaged,
                hasUntracked,
                changelistId: node.data?.changelistId,
                changelistMode: changelistState.mode,
                preventDefaultContextMenuItems: true
            } satisfies ChangelistFolderContext;
        }
        return {
            webviewSection: 'changelistFile',
            path: node.data.path,
            paths: [node.data.path],
            hunkIds: node.data.hunkIds,
            status: node.data.status,
            isStaged: Boolean(node.data.staged),
            isConflict: node.data.status === 'C' || node.data.status === 'U',
            isInactive: changelistState.mode === 'staged'
                ? Boolean(node.data.inactive || node.id.startsWith('inactive-changes/'))
                : false,
            isUntracked: node.data.status === '?',
            hasConflict,
            hasInactive,
            allInactive,
            hasStaged,
            allStaged,
            hasUntracked,
            changelistId: node.data.changelistId,
            changelistMode: changelistState.mode,
            preventDefaultContextMenuItems: true
        } satisfies ChangelistFileContext;
    }, [changelistState.lists, changelistState.mode]);

    const isDraggable = useCallback((node: TreeNode<FileNodeData>) => {
        if (node.id.startsWith('amend/')) return false;

        if (changelistState.mode === 'changes') {
            return Boolean(node.data?.isFile || (!node.data?.isRoot && node.children));
        }

        if (changelistState.mode === 'staged') {
            if (node.id.startsWith('untracked-changes/')) return false;
            return Boolean(node.data?.isFile || (!node.data?.isRoot && node.children));
        }

        return false;
    }, [changelistState.mode]);

    const isDropTarget = useCallback((node: TreeNode<FileNodeData>) => {
        const changelistId = node.data?.changelistId;
        if (!changelistId) return false;

        if (changelistState.mode === 'changes') {
            return changelistState.lists.some(list => list.id === changelistId);
        }

        if (changelistState.mode === 'staged') {
            return changelistId === 'staged-changes' || changelistId === 'changes' || changelistId === 'inactive-changes';
        }

        return false;
    }, [changelistState.lists, changelistState.mode]);

    const getDropTargetRootId = useCallback((node: TreeNode<FileNodeData>) => {
        const changelistId = node.data?.changelistId;
        if (!changelistId) return null;
        if (changelistState.mode === 'changes' && changelistState.lists.some(list => list.id === changelistId)) {
            return `__root__${changelistId}`;
        }
        if (changelistState.mode === 'staged') {
            if (changelistId === 'staged-changes' || changelistId === 'changes' || changelistId === 'inactive-changes') {
                return `__root__${changelistId}`;
            }
        }
        return null;
    }, [changelistState.lists, changelistState.mode]);

    const handleDrop = useCallback(async (draggedNode: TreeNode<FileNodeData>, targetNode: TreeNode<FileNodeData>) => {
        logger.info(`Drop detected ${draggedNode.id} -> ${targetNode.id}`);
        const targetListId = targetNode.data?.changelistId;
        if (!targetListId) {
            return;
        }

        const moveData = getAllMoveData(draggedNode);
        const paths = moveData.paths;

        if (changelistState.mode === 'changes') {
            const sourceChangelistId = draggedNode.data?.changelistId;
            const shouldActivateLegacyInactive = sourceChangelistId === 'inactive-changes' && targetListId !== 'inactive-changes';

            if (shouldActivateLegacyInactive && paths.length > 0) {
                await rpc.markFilesActive(paths);
            }
            if (shouldActivateLegacyInactive) {
                for (const [path, hunkIds] of Object.entries(moveData.hunkMap)) {
                    for (const hunkId of hunkIds) {
                        await rpc.markHunkActive({ path, hunkId });
                    }
                }
            }

            if (paths.length > 0) {
                await rpc.moveFilesToChangelist({ paths, targetListId });
            }
            for (const [path, hunkIds] of Object.entries(moveData.hunkMap)) {
                if (hunkIds.length > 0) {
                    await rpc.moveHunksToChangelist({ path, hunkIds, targetListId });
                }
            }
        } else if (changelistState.mode === 'staged') {
            if (paths.length === 0) return;

            const sourceChangelistId = draggedNode.data?.changelistId;

            if (targetListId === 'staged-changes') {
                if (sourceChangelistId === 'inactive-changes') {
                    await rpc.markFilesActive(paths);
                }
                await rpc.stageFiles(paths);
            } else if (targetListId === 'changes') {
                if (sourceChangelistId === 'staged-changes') {
                    await rpc.unstageFiles(paths);
                } else if (sourceChangelistId === 'inactive-changes') {
                    await rpc.markFilesActive(paths);
                }
            } else if (targetListId === 'inactive-changes') {
                await rpc.markFilesInactive(paths);
            }
        }

        rpcEvents.refresh.emit();
    }, [changelistState.mode]);

    const getDragData = useCallback((node: TreeNode<FileNodeData>): Record<string, string> => {
        const moveData = getAllMoveData(node);
        const paths = Array.from(new Set([
            ...moveData.paths,
            ...Object.keys(moveData.hunkMap)
        ]));
        if (paths.length === 0) return {};

        const root = workspaceRoot || '';
        const absPaths = paths.map(path => root ? `${root}/${path}` : path);
        const fileUris = absPaths.map(path => `file://${encodeURI(path)}`);
        const uriList = fileUris.join('\r\n');

        return {
            'text/uri-list': uriList,
            'text/plain': absPaths.join('\n'),
            'application/vnd.code.uri-list': uriList
        };
    }, [workspaceRoot]);

    const getDragLabel = useCallback((node: TreeNode<FileNodeData>) => ({
        label: node.label,
        count: countFiles(node)
    }), []);

    return (
        <BasicTreeView
            ref={treeRef}
            nodes={nodes}
            expandedIds={expandedIds}
            onToggle={onToggle}
            defaultExpandAll={true}
            stickyHeaders={true}
            selectedId={activeFile || undefined}
            onSelect={handleNodeClick}
            onDoubleClick={handleNodeDoubleClick}
            onFocusNodeChange={handleFocusNodeChange}
            onFocusChange={(focused) => void rpc.setChangelistTreeFocus(focused)}
            renderLabel={renderLabel}
            renderTrailing={renderTrailing}
            getContextData={getContextData}
            getNodeClassName={(node) => node.data?.showInDragMode ? 'dropOnlyGroup' : undefined}
            indent={16}
            baseIndent={8}
            isDraggable={isDraggable}
            isDropTarget={isDropTarget}
            getDropTargetRootId={getDropTargetRootId}
            onDrop={handleDrop}
            getDragData={getDragData}
            getDragLabel={getDragLabel}
            rootContextData={changelistState.mode === 'changes' ? {
                webviewSection: 'changelistBackground',
                changelistMode: changelistState.mode,
                preventDefaultContextMenuItems: true
            } satisfies ChangelistBackgroundContext : undefined}
        />
    );
});
