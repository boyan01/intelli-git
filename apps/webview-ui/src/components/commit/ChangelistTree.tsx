import React, { useMemo, useCallback, useRef } from 'react';
import type {
    ChangelistGroup,
    ChangelistState,
    FileStatus,
    LastCommitInfo,
    RepositoryFileReference,
    RepositoryInfo,
} from '@shared/messages';
import type {
    ChangelistBackgroundContext,
    ChangelistFileContext,
    ChangelistFolderContext,
    ChangelistRepositoryContext,
    ChangelistRootContext,
} from '@shared/webviewContext';
import { useTranslation } from 'react-i18next';
import { BasicTreeView } from '../common/BasicTreeView';
import type { TreeNode, BasicTreeViewRef, TreeNodeRenderState } from '../common/BasicTreeView';
import { FileIcon, FolderIcon } from '../common/FileIcon';
import { useCompactFileTreeLayout } from '@/lib/fileIconTheme';
import { emitRefresh, rpc } from '@/lib/rpc_client';
import { logger } from '@/utils/logger';
import styles from '../file-tree/BaseFileTree.module.css';
import { compactSingleChildFolders } from '../file-tree/treeUtils';
import {
    buildSplitInfoByPath,
    CONFLICTING_CHANGES_ID,
    getSelectionKey,
    type SplitFileInfo,
    type WorkspaceChangelistGroup,
} from './changelistModel';

export interface ChangelistTreeProps {
    groups: WorkspaceChangelistGroup[];
    changelistState: ChangelistState;
    viewMode: 'tree' | 'list';
    selectedFiles: Set<string>;
    expandedIds?: Set<string>;
    activeFile?: string | null;
    onToggle?: (id: string, expanded: boolean) => void;
    readonly?: boolean;
    workspaceRoot?: string;
    showRepositoryRoots?: boolean;
    amendCommit?: LastCommitInfo | null;
    onOpenConflict?: (file: RepositoryFileReference) => void;
}

export interface ChangelistTreeRef {
    expandAll: () => void;
    collapseAll: () => void;
}

interface FileNodeData {
    repoPath?: string;
    repository?: RepositoryInfo;
    workspaceRoot?: string;
    path: string;
    /** Repository-relative folder path for folder nodes. */
    folderPath?: string;
    isFile: boolean;
    isRepositoryRoot?: boolean;
    hunkIds?: string[];
    isRoot?: boolean;
    isInactiveGroup?: boolean;
    isStagedGroup?: boolean;
    isConflictGroup?: boolean;
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
    splitInfo?: SplitFileInfo;
}

const getDirPath = (fullPath: string): string => {
    const lastSlash = fullPath.lastIndexOf('/');
    return lastSlash > 0 ? fullPath.substring(0, lastSlash) : '';
};

// Include the repository folder so top-level items see it as their parent folder, as in the Explorer.
const getIconPath = (repoPath: string | undefined, relativePath: string): string =>
    repoPath ? `${repoPath.replace(/[\\/]+$/, '')}/${relativePath}` : relativePath;

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

const buildTree = (
    files: FileStatus[],
    splitInfoByPath: Map<string, SplitFileInfo>,
    repository: RepositoryInfo,
    workspaceRoot: string
): TreeNode<FileNodeData>[] => {
    const root: TreeNode<FileNodeData>[] = [];
    const map = new Map<string, TreeNode<FileNodeData>>();

    files.forEach((file) => {
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
                        repoPath: repository.repoPath,
                        repository,
                        workspaceRoot,
                        path: file.path,
                        folderPath: isLast ? undefined : currentPath,
                        isFile: isLast,
                        status: isLast ? file.status : undefined,
                        staged: isLast ? file.staged : undefined,
                        inactive: isLast ? file.inactive : undefined,
                        hunkIds: isLast && file.status !== '?' ? file.hunks?.map((hunk) => hunk.id) : undefined,
                        resolvedCandidate: isLast ? file.resolvedCandidate : undefined,
                        splitInfo: isLast
                            ? splitInfoByPath.get(getSelectionKey(repository.repoPath, file.path))
                            : undefined,
                        fileCount: 0,
                    },
                    children: isLast ? [] : [],
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
        nodes.forEach((node) => {
            if (node.children) processNodes(node.children);
            node.data!.fileCount = countFiles(node);
        });
    };

    processNodes(root);
    return compactSingleChildFolders(root);
};

const prefixNodes = (nodes: TreeNode<FileNodeData>[], prefix: string, listId?: string): TreeNode<FileNodeData>[] => {
    return nodes.map((node) => ({
        ...node,
        id: `${prefix}/${node.id}`,
        data: node.data
            ? {
                  ...node.data,
                  changelistId: listId,
              }
            : undefined,
        children: node.children ? prefixNodes(node.children, prefix, listId) : undefined,
    }));
};

function getAllMoveData(node: TreeNode<FileNodeData>): { paths: string[]; hunkMap: Record<string, string[]> } {
    if (node.data?.isFile) {
        if (node.data.hunkIds && node.data.hunkIds.length > 0) {
            return {
                paths: [],
                hunkMap: { [node.data.path]: node.data.hunkIds },
            };
        }

        return {
            paths: [node.data.path],
            hunkMap: {},
        };
    }

    const paths = new Set<string>();
    const hunkMap: Record<string, string[]> = {};
    node.children?.forEach((child) => {
        const childData = getAllMoveData(child);
        childData.paths.forEach((path) => paths.add(path));
        Object.entries(childData.hunkMap).forEach(([path, hunkIds]) => {
            hunkMap[path] = [...(hunkMap[path] || []), ...hunkIds];
        });
    });

    return {
        paths: Array.from(paths),
        hunkMap,
    };
}

function getDescendantFiles(node: TreeNode<FileNodeData>): FileNodeData[] {
    if (node.data?.isFile) {
        return node.data.path ? [node.data] : [];
    }

    return (node.children || []).flatMap((child) => getDescendantFiles(child));
}

function getCommonRepoPath(files: FileNodeData[]): string | undefined {
    const repoPaths = Array.from(new Set(files.map((file) => file.repoPath).filter(Boolean)));
    return repoPaths.length === 1 ? repoPaths[0] : undefined;
}

function getCommonChangelistId(group: WorkspaceChangelistGroup): string | undefined {
    const ids = Array.from(new Set(group.repositories.map((repoGroup) => repoGroup.group.id)));
    return ids.length === 1 ? ids[0] : undefined;
}

export const ChangelistTree = React.forwardRef<ChangelistTreeRef, ChangelistTreeProps>(
    (
        {
            groups,
            changelistState,
            viewMode,
            expandedIds,
            activeFile,
            onToggle,
            workspaceRoot,
            showRepositoryRoots = true,
            amendCommit,
            onOpenConflict,
        },
        ref
    ) => {
        const { t } = useTranslation();
        const treeRef = useRef<BasicTreeViewRef>(null);

        React.useImperativeHandle(ref, () => ({
            expandAll: () => treeRef.current?.expandAll(),
            collapseAll: () => treeRef.current?.collapseAll(),
        }));

        const splitInfoByPath = useMemo(() => {
            const result = new Map<string, SplitFileInfo>();
            const groupsByRepo = new Map<string, ChangelistGroup[]>();
            groups.forEach((group) => {
                group.repositories.forEach((repoGroup) => {
                    const repoGroups = groupsByRepo.get(repoGroup.repository.repoPath) || [];
                    repoGroups.push(repoGroup.group);
                    groupsByRepo.set(repoGroup.repository.repoPath, repoGroups);
                });
            });
            groupsByRepo.forEach((repoGroups, repoPath) => {
                buildSplitInfoByPath(repoGroups).forEach((value, path) => {
                    result.set(getSelectionKey(repoPath, path), value);
                });
            });
            return result;
        }, [groups]);

        const nodes = useMemo(() => {
            const result: TreeNode<FileNodeData>[] = [];

            groups.forEach((group) => {
                const repoGroups = group.repositories.filter((repoGroup) => repoGroup.group.items.length > 0);
                const changelistId = getCommonChangelistId(group);
                const children = repoGroups.flatMap((repoGroup) => {
                    const repoNodeId = `${group.id}::repo::${repoGroup.repository.repoPath}`;
                    const repoChildren =
                        viewMode === 'list'
                            ? repoGroup.group.items.map((file) => ({
                                  id: `${repoNodeId}/${file.path}`,
                                  label: file.path.split('/').pop() || file.path,
                                  data: {
                                      repoPath: repoGroup.repository.repoPath,
                                      repository: repoGroup.repository,
                                      workspaceRoot: repoGroup.workspaceRoot,
                                      path: file.path,
                                      isFile: true,
                                      status: file.status,
                                      staged: file.staged,
                                      inactive: file.inactive,
                                      hunkIds: file.status !== '?' ? file.hunks?.map((hunk) => hunk.id) : undefined,
                                      resolvedCandidate: file.resolvedCandidate,
                                      fileCount: 1,
                                      changelistId: repoGroup.group.id,
                                      splitInfo: splitInfoByPath.get(
                                          getSelectionKey(repoGroup.repository.repoPath, file.path)
                                      ),
                                  },
                                  children: undefined,
                              }))
                            : prefixNodes(
                                  buildTree(
                                      repoGroup.group.items,
                                      splitInfoByPath,
                                      repoGroup.repository,
                                      repoGroup.workspaceRoot
                                  ),
                                  `${repoNodeId}/files`,
                                  repoGroup.group.id
                              );

                    if (!showRepositoryRoots) {
                        return repoChildren;
                    }

                    return [
                        {
                            id: repoNodeId,
                            label: repoGroup.repository.name,
                            data: {
                                repoPath: repoGroup.repository.repoPath,
                                repository: repoGroup.repository,
                                workspaceRoot: repoGroup.workspaceRoot,
                                path: '',
                                isFile: false,
                                isRepositoryRoot: true,
                                fileCount: repoGroup.group.items.length,
                                changelistId: repoGroup.group.id,
                                isActiveChangelist: repoGroup.group.isActive,
                            },
                            children: repoChildren,
                        } satisfies TreeNode<FileNodeData>,
                    ];
                });

                result.push({
                    id: `__root__${group.id}`,
                    label: group.name,
                    data: {
                        path: '',
                        isFile: false,
                        isRoot: true,
                        isInactiveGroup: group.id === 'inactive-changes',
                        isStagedGroup: group.id === 'staged-changes',
                        isConflictGroup: group.id === CONFLICTING_CHANGES_ID,
                        fileCount: group.repositories.reduce((sum, repoGroup) => sum + repoGroup.group.items.length, 0),
                        hasWarning: group.hasWarning,
                        changelistId,
                        isActiveChangelist: group.isActive,
                        isChangelistGroup:
                            group.id !== 'staged-changes' &&
                            group.id !== 'untracked-changes' &&
                            group.id !== CONFLICTING_CHANGES_ID,
                        showInDragMode:
                            group.items.length === 0 &&
                            (group.id === 'staged-changes' ||
                                group.id === 'changes' ||
                                group.id === 'inactive-changes'),
                    },
                    children,
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
                        fileCount: amendCommit.files.length,
                    },
                    children: amendCommit.files.map((file) => ({
                        id: `amend/${file.path}`,
                        label: file.path.split('/').pop() || file.path,
                        data: {
                            path: file.path,
                            isFile: true,
                            isAmendFile: true,
                            status: file.status,
                            fileCount: 1,
                        },
                    })),
                });
            }

            return result;
        }, [groups, viewMode, amendCommit, splitInfoByPath, showRepositoryRoots]);

        const handleNodeClick = useCallback(
            (node: TreeNode<FileNodeData>) => {
                if (node.data?.isFile) {
                    if (node.data.status === 'C' || node.data.status === 'U') {
                        onOpenConflict?.({ path: node.data.path, repoPath: node.data.repoPath });
                        return;
                    }
                    if (node.data.status === 'D') {
                        rpc.openDiff({ path: node.data.path, repoPath: node.data.repoPath, staged: node.data.staged });
                    } else {
                        rpc.openFile({ path: node.data.path, repoPath: node.data.repoPath, preserveFocus: true });
                    }
                }
            },
            [onOpenConflict]
        );

        const handleNodeDoubleClick = useCallback(
            (node: TreeNode<FileNodeData>) => {
                if (node.data?.isFile) {
                    if (node.data.status === 'C' || node.data.status === 'U') {
                        onOpenConflict?.({ path: node.data.path, repoPath: node.data.repoPath });
                        return;
                    }
                    if (node.data.status === 'D') {
                        rpc.openDiff({ path: node.data.path, repoPath: node.data.repoPath, staged: node.data.staged });
                    } else {
                        rpc.openFile({ path: node.data.path, repoPath: node.data.repoPath, preserveFocus: false });
                    }
                }
            },
            [onOpenConflict]
        );

        const handleFocusNodeChange = useCallback((node: TreeNode<FileNodeData>) => {
            if (!node.data?.isFile) {
                void rpc.setActiveChangelistFile(null);
                return;
            }

            void rpc.setActiveChangelistFile({
                repoPath: node.data.repoPath,
                path: node.data.path,
                status: node.data.status,
                staged: node.data.staged,
                inactive: node.data.inactive,
                isConflict: node.data.status === 'C' || node.data.status === 'U',
            });
        }, []);

        const renderTrailing = useCallback(
            (node: TreeNode<FileNodeData>) => {
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
                const actionableFileNodes = fileNodes.filter(
                    (file) =>
                        !file.inactive &&
                        ((file.status !== 'C' && file.status !== 'U') || Boolean(file.resolvedCandidate))
                );
                if (actionableFileNodes.length === 0) {
                    return null;
                }

                const isAllStaged = actionableFileNodes.every((file) => file.staged);
                const action = isAllStaged
                    ? {
                          kind: 'unstage' as const,
                          title: t('Unstage'),
                      }
                    : {
                          kind: 'stage' as const,
                          title: t('Stage'),
                      };
                const refs = Array.from(
                    new Map(
                        actionableFileNodes.map((file) => [
                            getSelectionKey(file.repoPath, file.path),
                            { repoPath: file.repoPath, path: file.path },
                        ])
                    ).values()
                );

                return (
                    <div className={styles.groupTrailing}>
                        <button
                            type="button"
                            className={styles.hoverAction}
                            title={action.title}
                            onClick={async (event) => {
                                event.stopPropagation();
                                if (action.kind === 'stage') {
                                    await rpc.stageFiles(refs);
                                } else {
                                    await rpc.unstageFiles(refs);
                                }
                                emitRefresh(['commit'], 'files-staged');
                            }}
                        >
                            <i className={`codicon ${action.kind === 'stage' ? 'codicon-add' : 'codicon-remove'}`} />
                        </button>
                    </div>
                );
            },
            [changelistState, t]
        );

        const compactLayout = useCompactFileTreeLayout();

        const renderLabel = useCallback(
            (node: TreeNode<FileNodeData>, { expanded }: TreeNodeRenderState) => {
                const status = node.data?.status;
                const statusColor = getStatusColor(status);
                const isDeleted = status === 'D';
                const isAmendFile = node.data?.isAmendFile;
                const showPath = viewMode === 'list' && (node.data?.isFile || isAmendFile);

                if (node.data?.isAmendCommit) {
                    return (
                        <div className={styles.fileItemContent}>
                            <span className={`codicon codicon-git-commit ${styles.icon}`}></span>
                            <span className={styles.name} style={{ fontStyle: 'italic' }}>
                                {node.label}
                            </span>
                        </div>
                    );
                }

                if (node.data?.isRoot) {
                    return (
                        <div className={styles.rootTitleGroup}>
                            <span
                                className={styles.rootTitle}
                                style={node.data.isActiveChangelist ? { fontWeight: 700 } : undefined}
                            >
                                {node.label}
                            </span>
                            <span className={styles.fileCount}>{node.data.fileCount}</span>
                            {node.data.isConflictGroup && (
                                <span
                                    className={`codicon codicon-warning ${styles.icon}`}
                                    style={{
                                        color: 'var(--vscode-gitDecoration-conflictingResourceForeground)',
                                        marginLeft: '4px',
                                    }}
                                    aria-hidden="true"
                                ></span>
                            )}
                            {node.data.hasWarning && (
                                <span
                                    className={`codicon codicon-warning ${styles.icon}`}
                                    style={{
                                        color: 'var(--vscode-notificationsWarningIcon-foreground)',
                                        marginLeft: '4px',
                                    }}
                                    title={t(
                                        'Some inactive changes in this group are staged externally. They will be automatically excluded by the plugin during commit.'
                                    )}
                                ></span>
                            )}
                        </div>
                    );
                }

                if (node.data?.isRepositoryRoot) {
                    const branchLabel =
                        node.data.repository?.branch ||
                        (node.data.repository?.isDetached && node.data.repository.head
                            ? node.data.repository.head.substring(0, 7)
                            : undefined);
                    return (
                        <div className={styles.fileItemContent}>
                            <span className={`codicon codicon-repo ${styles.icon}`}></span>
                            <span
                                className={styles.name}
                                style={node.data.isActiveChangelist ? { fontWeight: 600 } : undefined}
                            >
                                {node.label}
                            </span>
                            {branchLabel && <span className={styles.fileDirPath}>{branchLabel}</span>}
                            <span className={styles.fileCount}>{node.data.fileCount}</span>
                        </div>
                    );
                }

                if (node.data?.isFile) {
                    const splitInfo = node.data.splitInfo;
                    const statusClass =
                        status === 'M'
                            ? styles.statusM
                            : status === 'A'
                              ? styles.statusA
                              : status === 'D'
                                ? styles.statusD
                                : status === 'R'
                                  ? styles.statusR
                                  : status === '?'
                                    ? styles.statusUntracked
                                    : '';

                    return (
                        <div className={styles.fileItemContent} data-drag-label="true">
                            <FileIcon
                                path={getIconPath(node.data.repoPath, node.data.path)}
                                className={styles.fileIconSvg}
                                fallbackColor={statusColor}
                                labelColor={isDeleted ? undefined : statusColor}
                            />
                            <span
                                className={`${styles.name} ${statusClass}`}
                                style={isDeleted ? undefined : { color: statusColor }}
                            >
                                {node.label}
                            </span>
                            {splitInfo && (
                                <span
                                    className={styles.splitBadge}
                                    title={t('This file has changes in {{groups}}.', {
                                        groups: splitInfo.groupNames.join(', '),
                                    })}
                                >
                                    {t('Split')}
                                </span>
                            )}
                            {node.data.resolvedCandidate && (
                                <span
                                    className={styles.splitBadge}
                                    title={t('No conflict markers remain. Mark this file as resolved to stage it.')}
                                >
                                    {t('Resolved')}
                                </span>
                            )}
                            {showPath && <span className={styles.fileDirPath}>{getDirPath(node.data.path)}</span>}
                        </div>
                    );
                }

                return (
                    <div className={styles.fileItemContent}>
                        <FolderIcon
                            path={getIconPath(node.data?.repoPath, node.data?.folderPath ?? node.label)}
                            expanded={expanded}
                            className={styles.fileIconSvg}
                            fallbackClassName={styles.icon}
                        />
                        <span className={styles.name}>{node.label}</span>
                    </div>
                );
            },
            [t, viewMode]
        );

        const getContextData = useCallback(
            (node: TreeNode<FileNodeData>) => {
                const descendantFiles = getDescendantFiles(node);
                const paths = Array.from(new Set(descendantFiles.map((file) => file.path)));
                const hasConflict = descendantFiles.some((file) => file.status === 'C' || file.status === 'U');
                const hasInactive = descendantFiles.some((file) => Boolean(file.inactive));
                const allInactive =
                    descendantFiles.length > 0 && descendantFiles.every((file) => Boolean(file.inactive));
                const hasStaged = descendantFiles.some((file) => Boolean(file.staged));
                const allStaged = descendantFiles.length > 0 && descendantFiles.every((file) => Boolean(file.staged));
                const hasUntracked = descendantFiles.some((file) => file.status === '?');
                const hasResolvedCandidate = descendantFiles.some((file) => Boolean(file.resolvedCandidate));
                const repoPath = getCommonRepoPath(descendantFiles);

                if (!node.data?.isFile) {
                    if (node.data?.isRepositoryRoot && node.data.repoPath) {
                        return {
                            webviewSection: 'changelistRepository',
                            repoPath: node.data.repoPath,
                            paths,
                            hasConflict,
                            hasInactive,
                            allInactive,
                            hasStaged,
                            allStaged,
                            hasUntracked,
                            hasResolvedCandidate,
                            changelistId: node.data.changelistId,
                            changelistMode: changelistState.mode,
                            preventDefaultContextMenuItems: true,
                        } satisfies ChangelistRepositoryContext;
                    }

                    if (node.data?.isRoot) {
                        const changelist = changelistState.lists.find((list) => list.id === node.data?.changelistId);
                        return {
                            webviewSection: 'changelistRoot',
                            repoPath,
                            changelistId: node.data.changelistId,
                            paths,
                            isActiveChangelist: Boolean(node.data.isActiveChangelist),
                            canSetActiveChangelist: Boolean(
                                changelist &&
                                !node.data.isActiveChangelist &&
                                node.data.changelistId !== 'inactive-changes'
                            ),
                            canDeleteChangelist: Boolean(changelist && !changelist.isDefault),
                            hasConflict,
                            hasInactive,
                            allInactive,
                            hasStaged,
                            allStaged,
                            hasUntracked,
                            hasResolvedCandidate,
                            changelistMode: changelistState.mode,
                            preventDefaultContextMenuItems: true,
                        } satisfies ChangelistRootContext;
                    }

                    return {
                        webviewSection: 'changelistFolder',
                        repoPath,
                        path: node.id,
                        paths,
                        hasConflict,
                        hasInactive,
                        allInactive,
                        hasStaged,
                        allStaged,
                        hasUntracked,
                        hasResolvedCandidate,
                        changelistId: node.data?.changelistId,
                        changelistMode: changelistState.mode,
                        preventDefaultContextMenuItems: true,
                    } satisfies ChangelistFolderContext;
                }
                return {
                    webviewSection: 'changelistFile',
                    repoPath: node.data.repoPath,
                    path: node.data.path,
                    paths: [node.data.path],
                    hunkIds: node.data.hunkIds,
                    status: node.data.status,
                    isStaged: Boolean(node.data.staged),
                    isConflict: node.data.status === 'C' || node.data.status === 'U',
                    resolvedCandidate: node.data.resolvedCandidate,
                    isInactive:
                        changelistState.mode === 'staged'
                            ? Boolean(node.data.inactive || node.id.startsWith('inactive-changes/'))
                            : false,
                    isUntracked: node.data.status === '?',
                    hasConflict,
                    hasInactive,
                    allInactive,
                    hasStaged,
                    allStaged,
                    hasUntracked,
                    hasResolvedCandidate: Boolean(node.data.resolvedCandidate),
                    changelistId: node.data.changelistId,
                    changelistMode: changelistState.mode,
                    preventDefaultContextMenuItems: true,
                } satisfies ChangelistFileContext;
            },
            [changelistState.lists, changelistState.mode]
        );

        const isDraggable = useCallback(
            (node: TreeNode<FileNodeData>) => {
                if (node.id.startsWith('amend/')) return false;
                if (node.data?.changelistId === CONFLICTING_CHANGES_ID) return false;

                if (changelistState.mode === 'changes') {
                    return Boolean(node.data?.isFile || (!node.data?.isRoot && node.children));
                }

                if (changelistState.mode === 'staged') {
                    if (node.id.startsWith('untracked-changes/')) return false;
                    return Boolean(node.data?.isFile || (!node.data?.isRoot && node.children));
                }

                return false;
            },
            [changelistState.mode]
        );

        const isDropTarget = useCallback(
            (node: TreeNode<FileNodeData>) => {
                const changelistId = node.data?.changelistId;
                if (!changelistId) return false;

                if (changelistState.mode === 'changes') {
                    return changelistState.lists.some((list) => list.id === changelistId);
                }

                if (changelistState.mode === 'staged') {
                    return (
                        changelistId === 'staged-changes' ||
                        changelistId === 'changes' ||
                        changelistId === 'inactive-changes'
                    );
                }

                return false;
            },
            [changelistState.lists, changelistState.mode]
        );

        const getDropTargetRootId = useCallback(
            (node: TreeNode<FileNodeData>) => {
                const changelistId = node.data?.changelistId;
                if (!changelistId) return null;
                if (
                    changelistState.mode === 'changes' &&
                    changelistState.lists.some((list) => list.id === changelistId)
                ) {
                    return `__root__${changelistId}`;
                }
                if (changelistState.mode === 'staged') {
                    if (
                        changelistId === 'staged-changes' ||
                        changelistId === 'changes' ||
                        changelistId === 'inactive-changes'
                    ) {
                        return `__root__${changelistId}`;
                    }
                }
                return null;
            },
            [changelistState.lists, changelistState.mode]
        );

        const handleDrop = useCallback(
            async (draggedNode: TreeNode<FileNodeData>, targetNode: TreeNode<FileNodeData>) => {
                logger.info(`Drop detected ${draggedNode.id} -> ${targetNode.id}`);
                const targetListId = targetNode.data?.changelistId;
                if (!targetListId) {
                    return;
                }
                const sourceRepoPath = getCommonRepoPath(getDescendantFiles(draggedNode));
                const targetRepoPath = targetNode.data?.repoPath || getCommonRepoPath(getDescendantFiles(targetNode));
                if (sourceRepoPath && targetRepoPath && sourceRepoPath !== targetRepoPath) {
                    return;
                }

                const moveData = getAllMoveData(draggedNode);
                const paths = moveData.paths;

                if (changelistState.mode === 'changes') {
                    const sourceChangelistId = draggedNode.data?.changelistId;
                    await rpc.moveChangesToChangelist({
                        repoPath: sourceRepoPath,
                        targetListId,
                        paths,
                        hunksByPath: moveData.hunkMap,
                        activateInactive:
                            sourceChangelistId === 'inactive-changes' && targetListId !== 'inactive-changes',
                    });
                } else if (changelistState.mode === 'staged') {
                    if (paths.length === 0) return;

                    const sourceChangelistId = draggedNode.data?.changelistId;

                    if (targetListId === 'staged-changes') {
                        if (sourceChangelistId === 'inactive-changes') {
                            await rpc.markFilesActive(paths.map((path) => ({ repoPath: sourceRepoPath, path })));
                        }
                        await rpc.stageFiles(paths.map((path) => ({ repoPath: sourceRepoPath, path })));
                    } else if (targetListId === 'changes') {
                        if (sourceChangelistId === 'staged-changes') {
                            await rpc.unstageFiles(paths.map((path) => ({ repoPath: sourceRepoPath, path })));
                        } else if (sourceChangelistId === 'inactive-changes') {
                            await rpc.markFilesActive(paths.map((path) => ({ repoPath: sourceRepoPath, path })));
                        }
                    } else if (targetListId === 'inactive-changes') {
                        await rpc.markFilesInactive(paths.map((path) => ({ repoPath: sourceRepoPath, path })));
                    }
                }

                emitRefresh(['commit'], 'changelist-updated');
            },
            [changelistState.mode]
        );

        const getDragData = useCallback(
            (node: TreeNode<FileNodeData>): Record<string, string> => {
                const moveData = getAllMoveData(node);
                const paths = Array.from(new Set([...moveData.paths, ...Object.keys(moveData.hunkMap)]));
                if (paths.length === 0) return {};

                const descendantFiles = getDescendantFiles(node);
                const rootByPath = new Map(
                    descendantFiles.map((file) => [file.path, file.workspaceRoot || workspaceRoot || ''])
                );
                const absPaths = paths.map((path) => {
                    const root = rootByPath.get(path) || workspaceRoot || '';
                    return root ? `${root}/${path}` : path;
                });
                const fileUris = absPaths.map((path) => `file://${encodeURI(path)}`);
                const uriList = fileUris.join('\r\n');

                return {
                    'text/uri-list': uriList,
                    'text/plain': absPaths.join('\n'),
                    'application/vnd.code.uri-list': uriList,
                };
            },
            [workspaceRoot]
        );

        const getDragLabel = useCallback(
            (node: TreeNode<FileNodeData>) => ({
                label: node.label,
                count: countFiles(node),
            }),
            []
        );

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
                getNodeClassName={(node) => (node.data?.showInDragMode ? 'dropOnlyGroup' : undefined)}
                indent={compactLayout ? 8 : 16}
                hideTwistie={compactLayout ? (node) => Boolean(node.data?.isFile) : undefined}
                baseIndent={8}
                isDraggable={isDraggable}
                isDropTarget={isDropTarget}
                getDropTargetRootId={getDropTargetRootId}
                onDrop={handleDrop}
                getDragData={getDragData}
                getDragLabel={getDragLabel}
                ariaLabel={t('Changes')}
                rootContextData={
                    {
                        webviewSection: 'changelistBackground',
                        changelistMode: changelistState.mode,
                        preventDefaultContextMenuItems: true,
                    } satisfies ChangelistBackgroundContext
                }
            />
        );
    }
);
