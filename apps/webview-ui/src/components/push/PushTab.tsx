import { useRef, useState, useCallback, useEffect } from 'react';
import { rpc, rpcEvents } from '@/lib/rpc_client';
import { logger } from '@/utils/logger';
import { useRpcEvent } from '@/hooks/useRpcEvent';
import { PushHeader } from './PushHeader';
import { PushFooter } from './PushFooter';
import { useTranslation } from 'react-i18next';
import { CommitAccordionItem } from './CommitAccordionItem';
import { PushChangesView } from './PushChangesView';
import { usePushBranches } from './hooks/usePushBranches';
import { usePushData } from './hooks/usePushData';

import styles from './PushTab.module.css';

type PushBranchesState = ReturnType<typeof usePushBranches>;

interface PushTabProps {
    pushBranches: PushBranchesState;
    reviewingCommitTarget?: boolean;
    onUseTargetForCommit?: () => void;
    onCommitTargetChanged?: () => void;
}

export function PushTab({
    pushBranches,
    reviewingCommitTarget = false,
    onUseTargetForCommit,
    onCommitTargetChanged
}: PushTabProps) {
    const { t } = useTranslation();
    const scrollAreaRef = useRef<HTMLDivElement>(null);

    // 1. Branch State
    const {
        remotes,
        remoteBranches,
        selectedRemote,
        setSelectedRemote,
        selectedRemoteBranch,
        setSelectedRemoteBranch,
        confirmSelectedTarget,
        isProtectedPushTarget,
        isRemoteBranchesLoading,
        isInitStateLoading
    } = pushBranches;

    // 2. Data State (Commits & Push)
    const {
        commits,
        totalCommits,
        hasMore,
        isLoading,
        isLoadingMore,
        reload,
        handleLoadMore
    } = usePushData(selectedRemote, selectedRemoteBranch);

    // 3. View State
    const [viewMode, setViewMode] = useState<'commits' | 'changes'>('commits');
    const [changesViewMode, setChangesViewMode] = useState<'tree' | 'list'>('tree');
    const [commitsViewMode, setCommitsViewMode] = useState<'tree' | 'list'>('tree');
    const [expandedCommitHash, setExpandedCommitHash] = useState<string | null>(null);

    // Subscribe to activeFile changes from extension
    const activeFile = useRpcEvent(rpcEvents.activeFileChange, null);

    // Debug logging for active file changes (optional, preserving previous behavior logic if needed, but reducing boilerplate)
    useEffect(() => {
        if (activeFile) {
            logger.info(`Active file changed: ${activeFile.path} ${activeFile.commitHash}`);
        }
    }, [activeFile]);

    const toggleCommit = useCallback((hash: string) => {
        setExpandedCommitHash(prev => prev === hash ? null : hash);
    }, []);

    const handleRemoteChange = useCallback((remote: string) => {
        setSelectedRemote(remote);
        if (reviewingCommitTarget) {
            onCommitTargetChanged?.();
        }
    }, [onCommitTargetChanged, reviewingCommitTarget, setSelectedRemote]);

    const handleRemoteBranchChange = useCallback((branch: string) => {
        setSelectedRemoteBranch(branch);
        if (reviewingCommitTarget) {
            onCommitTargetChanged?.();
        }
    }, [onCommitTargetChanged, reviewingCommitTarget, setSelectedRemoteBranch]);

    const handleFetch = useCallback(async () => {
        await rpc.fetch();
        await reload();
    }, [reload]);

    const handleOpenGitLog = useCallback(() => {
        void rpc.focusGitLog();
    }, []);

    const showEmptyState = !isLoading && totalCommits === 0 && Boolean(selectedRemote && selectedRemoteBranch);

    return (
        <div className={styles.container}>
            {/* Header */}
            <PushHeader
                selectedRemote={selectedRemote}
                selectedRemoteBranch={selectedRemoteBranch}
                remotes={remotes}
                remoteBranches={remoteBranches}
                viewMode={viewMode}
                isLoading={isRemoteBranchesLoading}
                showTargetPlaceholder={isInitStateLoading && !selectedRemote && !selectedRemoteBranch}
                onToggleView={() => setViewMode(m => m === 'commits' ? 'changes' : 'commits')}
                onRemoteChange={handleRemoteChange}
                onRemoteBranchChange={handleRemoteBranchChange}
                showCommitTargetAction={reviewingCommitTarget}
                onUseTargetForCommit={onUseTargetForCommit}
            />

            {/* Scroll Area */}
            <div className={styles.scrollArea} ref={scrollAreaRef} tabIndex={0}>
                {isLoading && commits.length === 0 && (
                    <div className={styles.emptyState}>
                        <i className={`codicon codicon-loading codicon-modifier-spin ${styles.emptyIcon}`} />
                        <div className={styles.emptyTitle}>{t('Loading...')}</div>
                    </div>
                )}

                {showEmptyState && (
                    <div className={styles.emptyState}>
                        <i className={`codicon codicon-check ${styles.emptyIcon}`} />
                        <div className={styles.emptyTitle}>{t('Everything up to date')}</div>
                        <div className={styles.emptyDescription}>
                            {t('No outgoing commits for {{target}}.', { target: `${selectedRemote}/${selectedRemoteBranch}` })}
                        </div>
                        <div className={styles.emptyActions}>
                            <button className={styles.emptyAction} onClick={handleFetch}>
                                <i className="codicon codicon-cloud-download" />
                                <span>{t('Fetch')}</span>
                            </button>
                            <button className={styles.emptyAction} onClick={handleOpenGitLog}>
                                <i className="codicon codicon-history" />
                                <span>{t('Open Git Log')}</span>
                            </button>
                        </div>
                    </div>
                )}

                {!isLoading && !showEmptyState && viewMode === 'commits' && (
                    <>
                        {commits.map((commit, index) => (
                            <CommitAccordionItem
                                key={commit.hash}
                                commit={commit}
                                isLatestUnpushed={index === 0}
                                isExpanded={expandedCommitHash === commit.hash}
                                onToggle={() => toggleCommit(commit.hash)}
                                fileViewMode={commitsViewMode}
                                onFileViewModeChange={setCommitsViewMode}
                                activeFile={activeFile || null}
                            />
                        ))}

                        {hasMore && (
                            <div
                                className={styles.loadMoreItem}
                                onClick={handleLoadMore}
                            >
                                {isLoadingMore ? (
                                    <>
                                        <i className="codicon codicon-sync codicon-modifier-spin" />
                                        <span>{t('Loading...')}</span>
                                    </>
                                ) : (
                                    <>
                                        <i className="codicon codicon-fold-down" />
                                        <span>{t('Load More')}</span>
                                    </>
                                )}
                            </div>
                        )}
                    </>
                )}

                {!isLoading && !showEmptyState && viewMode === 'changes' && (
                    <PushChangesView
                        commits={commits}
                        changesViewMode={changesViewMode}
                        setChangesViewMode={setChangesViewMode}
                        activeFile={activeFile}
                    />
                )}
            </div>

            {/* Footer */}
            <PushFooter
                commitCount={totalCommits}
                selectedRemote={selectedRemote}
                selectedRemoteBranch={selectedRemoteBranch}
                isProtectedTarget={isProtectedPushTarget}
                onPushComplete={() => {
                    confirmSelectedTarget();
                    // The backend sends a refresh event on git push, which triggers data reload.
                }}
            />
        </div>
    );
}
