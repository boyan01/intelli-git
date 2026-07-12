import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorktreeInfo } from '@shared/messages';
import type { WorktreeItemContext } from '@shared/webviewContext';
import { BasicTreeView, type TreeNode } from '../common/BasicTreeView';
import { LoadingProgressBar } from '../common/LoadingProgressBar';
import { emitRefresh, rpc } from '../../lib/rpc_client';
import styles from './WorktreeDrawer.module.css';

interface WorktreeDrawerProps {
    open: boolean;
    worktrees: WorktreeInfo[];
    loading: boolean;
    onClose: () => void;
}

interface WorktreeState {
    label: string;
    icon: string;
    className: string;
}

interface WorktreeNodeData {
    worktree: WorktreeInfo;
    state: WorktreeState;
}

function getDisplayPath(worktreePath: string): string {
    const parts = worktreePath.split('/').filter(Boolean);
    if (parts.length > 4) {
        return `.../${parts.slice(-4).join('/')}`;
    }
    return worktreePath;
}

function getShortHead(head?: string): string {
    return head ? head.slice(0, 8) : '';
}

function getWorktreeRef(worktree: WorktreeInfo, t: (key: string, options?: Record<string, string>) => string): string {
    return worktree.branch || (worktree.isDetached ? t('Detached at {{ref}}', { ref: getShortHead(worktree.head) }) : getShortHead(worktree.head));
}

function getWorktreeState(worktree: WorktreeInfo, t: (key: string, options?: Record<string, string>) => string): WorktreeState {
    if (!worktree.pathExists) {
        return {
            label: t('Missing'),
            icon: 'codicon-warning',
            className: styles.missingState
        };
    }

    if (worktree.isDirty) {
        return {
            label: t('Dirty'),
            icon: 'codicon-circle-filled',
            className: styles.dirtyState
        };
    }

    return {
        label: t('Checked out'),
        icon: 'codicon-git-branch',
        className: styles.normalState
    };
}

export function WorktreeDrawer({ open, worktrees, loading, onClose }: WorktreeDrawerProps) {
    const { t } = useTranslation();
    const sortedWorktrees = useMemo(() => [...worktrees].sort((a, b) => {
        if (a.pathExists !== b.pathExists) {
            return a.pathExists ? -1 : 1;
        }
        return a.path.localeCompare(b.path);
    }), [worktrees]);

    const nodes = useMemo<TreeNode<WorktreeNodeData>[]>(() => sortedWorktrees.map(worktree => {
        const state = getWorktreeState(worktree, t);
        const ref = getWorktreeRef(worktree, t);

        // Show detailed multiline information on hover for rich context
        const tooltip = [
            worktree.branch ? `${t('Branch')}: ${worktree.branch}` : `${t('Detached HEAD')}: ${getShortHead(worktree.head)}`,
            `${t('Status')}: ${state.label}`,
            `${t('Path')}: ${worktree.path}`
        ].join('\n');

        return {
            id: worktree.path,
            label: ref,
            title: tooltip,
            data: { worktree, state }
        };
    }), [sortedWorktrees, t]);

    const selectedId = useMemo(() => {
        return sortedWorktrees.find(worktree => worktree.isActiveRepository)?.path
            ?? sortedWorktrees.find(worktree => worktree.isCurrent)?.path;
    }, [sortedWorktrees]);
    const hasStaleWorktrees = useMemo(() => {
        return worktrees.some(worktree => worktree.isPrunable || !worktree.pathExists);
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

    const handleNodeSelect = useCallback((node: TreeNode<WorktreeNodeData>) => {
        if (!node.data) {
            return;
        }
        void handleWorktreeClick(node.data.worktree);
    }, [handleWorktreeClick]);

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
            preventDefaultContextMenuItems: true
        } satisfies WorktreeItemContext;
    }, []);

    const renderLabel = useCallback((node: TreeNode<WorktreeNodeData>) => {
        if (!node.data) {
            return node.label;
        }

        const { worktree, state } = node.data;

        return (
            <span className={styles.worktreeLabel}>
                <span className={`${styles.stateIcon} ${state.className}`} aria-hidden="true">
                    <i className={`codicon ${state.icon}`}></i>
                </span>
                <span className={styles.ref}>{node.label}</span>
                <span className={styles.path}>{getDisplayPath(worktree.path)}</span>
            </span>
        );
    }, []);

    const renderTrailing = useCallback(() => {
        // Do not render status label text in trailing position to prevent layout redundancy
        return null;
    }, []);

    const handlePrune = async () => {
        if (!hasStaleWorktrees) {
            return;
        }

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
                    <button
                        className={styles.iconBtn}
                        type="button"
                        title={t('Prune Stale Worktrees')}
                        aria-label={t('Prune Stale Worktrees')}
                        disabled={!hasStaleWorktrees}
                        onClick={handlePrune}
                    >
                        <span className="intelli-git-icon intelli-git-icon-broom" aria-hidden="true" />
                    </button>
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
