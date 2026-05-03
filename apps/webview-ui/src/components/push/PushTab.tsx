import { useRef, useState, useCallback, useEffect } from 'react';
import { rpcEvents } from '@/lib/rpc_client';
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

export function PushTab() {
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
        isRemoteBranchesLoading,
        isInitStateLoading
    } = usePushBranches();

    // 2. Data State (Commits & Push)
    const {
        commits,
        totalCommits,
        hasMore,
        isLoadingMore,
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
                onRemoteChange={setSelectedRemote}
                onRemoteBranchChange={setSelectedRemoteBranch}
            />

            {/* Scroll Area */}
            <div className={styles.scrollArea} ref={scrollAreaRef} tabIndex={0}>
                {viewMode === 'commits' && (
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

                {viewMode === 'changes' && (
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
                onPushComplete={() => {
                    // The backend sends a refresh event on git push, which triggers data reload.
                }}
            />
        </div>
    );
}
