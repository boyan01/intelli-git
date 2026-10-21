import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorktreeInfo } from '@shared/messages';
import type { WorktreeItemContext } from '@shared/webviewContext';
import { BasicTreeView, type TreeNode } from '../common/BasicTreeView';
import { LoadingProgressBar } from '../common/LoadingProgressBar';
import { emitRefresh, rpc } from '../../lib/rpc_client';
import { getShortestUniqueSuffixes, sortWorktrees } from './worktreeDisplay';
import styles from './WorktreeDrawer.module.css';

interface WorktreeDrawerProps {
    open: boolean;
    worktrees: WorktreeInfo[];
    loading: boolean;
    onClose: () => void;
}

interface WorktreeKind {
    icon: string;
    className: string;
}

interface WorktreeNodeData {
    worktree: WorktreeInfo;
    kind: WorktreeKind;
    displayPath: string;
}

type TranslateFn = (key: string, options?: Record<string, string>) => string;

function getShortHead(head?: string): string {
    return head ? head.slice(0, 8) : '';
}

function getWorktreeRef(worktree: WorktreeInfo, t: TranslateFn): string {
    return (
        worktree.branch ||
        (worktree.isDetached
            ? t('Detached at {{ref}}', { ref: getShortHead(worktree.head) })
            : getShortHead(worktree.head))
    );
}

// The leading icon only encodes the worktree kind; dirty state is a separate marker after the ref.
function getWorktreeKind(worktree: WorktreeInfo): WorktreeKind {
    if (!worktree.pathExists) {
        return { icon: 'codicon-warning', className: styles.missingKind };
    }
    if (worktree.isMain) {
        return { icon: 'codicon-repo', className: styles.normalKind };
    }
    return {
        icon: worktree.isDetached ? 'codicon-git-commit' : 'codicon-git-branch',
        className: styles.normalKind,
    };
}

function getWorktreeStatusLabel(worktree: WorktreeInfo, t: TranslateFn): string {
    if (!worktree.pathExists) {
        return t('Missing');
    }
    return worktree.isDirty ? t('Dirty') : t('Checked out');
}

export function WorktreeDrawer({ open, worktrees, loading, onClose }: WorktreeDrawerProps) {
    const { t } = useTranslation();
    const sortedWorktrees = useMemo(() => sortWorktrees(worktrees), [worktrees]);
    const displayPaths = useMemo(
        () => getShortestUniqueSuffixes(worktrees.map((worktree) => worktree.path)),
        [worktrees]
    );

    const nodes = useMemo<TreeNode<WorktreeNodeData>[]>(
        () =>
            sortedWorktrees.map((worktree) => {
                const ref = getWorktreeRef(worktree, t);

                // Show detailed multiline information on hover for rich context
                const tooltip = [
                    ...(worktree.isMain ? [t('Main Worktree')] : []),
                    worktree.branch
                        ? `${t('Branch')}: ${worktree.branch}`
                        : `${t('Detached HEAD')}: ${getShortHead(worktree.head)}`,
                    `${t('Status')}: ${getWorktreeStatusLabel(worktree, t)}`,
                    `${t('Path')}: ${worktree.path}`,
                ].join('\n');

                return {
                    id: worktree.path,
                    label: ref,
                    title: tooltip,
                    data: {
                        worktree,
                        kind: getWorktreeKind(worktree),
                        displayPath: displayPaths.get(worktree.path) ?? worktree.path,
                    },
                };
            }),
        [sortedWorktrees, displayPaths, t]
    );

    const selectedId = useMemo(() => {
        return (
            sortedWorktrees.find((worktree) => worktree.isActiveRepository)?.path ??
            sortedWorktrees.find((worktree) => worktree.isCurrent)?.path
        );
    }, [sortedWorktrees]);
    const hasStaleWorktrees = useMemo(() => {
        return worktrees.some((worktree) => worktree.isPrunable || !worktree.pathExists);
    }, [worktrees]);

    const handleWorktreeClick = useCallback(async (worktree: WorktreeInfo) => {
        if (!worktree.pathExists || worktree.isActiveRepository) {
            return;
        }

        const switched = await rpc.setActiveWorktree(worktree.path);
        if (!switched) {
            await rpc.openWorktree(worktree.path);
        }
        emitRefresh(['commit', 'branch', 'push', 'worktrees'], 'worktree-opened');
    }, []);

    const handleNodeSelect = useCallback(
        (node: TreeNode<WorktreeNodeData>) => {
            if (!node.data) {
                return;
            }
            void handleWorktreeClick(node.data.worktree);
        },
        [handleWorktreeClick]
    );

    const getContextData = useCallback((node: TreeNode<WorktreeNodeData>): Record<string, unknown> | undefined => {
        const worktree = node.data?.worktree;
        if (!worktree) {
            return undefined;
        }

        return {
            webviewSection: 'worktreeItem',
            path: worktree.path,
            branch: worktree.branch,
            pathExists: worktree.pathExists,
            isCurrent: worktree.isCurrent,
            isActiveRepository: worktree.isActiveRepository,
            isDirty: worktree.isDirty,
            isPrunable: worktree.isPrunable,
            preventDefaultContextMenuItems: true,
        } satisfies WorktreeItemContext;
    }, []);

    const renderLabel = useCallback(
        (node: TreeNode<WorktreeNodeData>) => {
            if (!node.data) {
                return node.label;
            }

            const { worktree, kind, displayPath } = node.data;

            return (
                <span className={styles.worktreeLabel}>
                    <span className={`${styles.kindIcon} ${kind.className}`} aria-hidden="true">
                        <i className={`codicon ${kind.icon}`}></i>
                    </span>
                    <span className={`${styles.ref} ${worktree.isActiveRepository ? styles.activeRef : ''}`}>
                        {node.label}
                    </span>
                    {worktree.isDirty && (
                        <span className={styles.dirtyMark} role="img" aria-label={t('Dirty')}>
                            <i className="codicon codicon-circle-filled"></i>
                        </span>
                    )}
                    {worktree.pathExists ? (
                        <span className={styles.path}>
                            <bdi>{displayPath}</bdi>
                        </span>
                    ) : (
                        <span className={`${styles.path} ${styles.missingPath}`}>{t('Missing')}</span>
                    )}
                </span>
            );
        },
        [t]
    );

    const renderTrailing = useCallback(
        (node: TreeNode<WorktreeNodeData>) => {
            const worktree = node.data?.worktree;
            // Opening the worktree that already backs this window would only duplicate it.
            if (!worktree?.pathExists || worktree.isCurrent) {
                return null;
            }

            return (
                <button
                    type="button"
                    className={styles.rowAction}
                    title={t('Open in New Window')}
                    aria-label={t('Open in New Window')}
                    onClick={(event) => {
                        event.stopPropagation();
                        void rpc.openWorktree(worktree.path);
                    }}
                >
                    <i className="codicon codicon-empty-window"></i>
                </button>
            );
        },
        [t]
    );

    const handlePrune = async () => {
        await rpc.pruneWorktrees();
        emitRefresh(['worktrees'], 'worktrees-pruned');
    };

    return (
        <section className={`${styles.drawer} ${open ? styles.open : ''}`} aria-label={t('Worktrees')}>
            <div className={styles.header}>
                <div className={styles.title}>
                    <span
                        className={`${styles.titleIcon} intelli-git-icon intelli-git-icon-worktree`}
                        aria-hidden="true"
                    />
                    <span>{t('Worktrees')}</span>
                </div>
                <div className={styles.actions}>
                    {hasStaleWorktrees && (
                        <button
                            className={styles.iconBtn}
                            type="button"
                            title={t('Prune Stale Worktrees')}
                            aria-label={t('Prune Stale Worktrees')}
                            onClick={handlePrune}
                        >
                            <span className="intelli-git-icon intelli-git-icon-broom" aria-hidden="true" />
                        </button>
                    )}
                    <button
                        className={styles.iconBtn}
                        type="button"
                        title={t('Close')}
                        aria-label={t('Close')}
                        onClick={onClose}
                    >
                        <i className="codicon codicon-close"></i>
                    </button>
                </div>
            </div>

            <LoadingProgressBar active={loading} ariaLabel={t('Loading...')} />

            <div className={styles.list}>
                {loading && worktrees.length === 0 ? (
                    <div className={styles.empty} />
                ) : (
                    <BasicTreeView
                        nodes={nodes}
                        selectedId={selectedId}
                        onSelect={handleNodeSelect}
                        onAction={handleNodeSelect}
                        onDoubleClick={handleNodeSelect}
                        renderLabel={renderLabel}
                        renderTrailing={renderTrailing}
                        getContextData={getContextData}
                        baseIndent={0}
                        ariaLabel={t('Worktrees')}
                    />
                )}
            </div>
        </section>
    );
}
