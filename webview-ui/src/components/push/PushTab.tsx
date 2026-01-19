import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { formatRelativeDate } from '../../utils/dateUtils';
import type { CommitDetails, FileStatus } from '@shared/messages';
import { rpc, rpcEvents } from '@/lib/rpc_client';
import { usePersistedState } from '../../hooks/usePersistedState';
import { useTranslation } from 'react-i18next';
import { BaseFileTree } from '../file-tree/BaseFileTree';
import type { BaseFileTreeRef } from '../file-tree/BaseFileTree';
import { ViewModeToggle } from '../common/ViewModeToggle';
import { PushHeader } from './PushHeader';
import { CommitAccordionItem } from './CommitAccordionItem';
import { PushFooter, type PushOptions, type PushStatus } from './PushFooter';
import styles from './PushTab.module.css';

type ViewMode = 'commits' | 'changes';

const PAGE_SIZE = 20;

export function PushTab() {
    const { t } = useTranslation();

    // Push state
    const [commits, setCommits] = useState<CommitDetails[]>([]);
    const [totalCommits, setTotalCommits] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [pushStatus, setPushStatus] = useState<PushStatus>('idle');
    const [pushError, setPushError] = useState<string | null>(null);

    // Branch selection state
    const [localBranch, setLocalBranch] = useState<string>('');
    const [remotes, setRemotes] = useState<string[]>([]);
    const [remoteBranches, setRemoteBranches] = useState<string[]>([]);
    const [selectedRemote, setSelectedRemote] = useState<string>('');
    const [selectedRemoteBranch, setSelectedRemoteBranch] = useState<string>('');

    // Persisted state for branch selection
    const [lastLocalBranch, setLastLocalBranch] = usePersistedState('push.lastLocalBranch');
    const [lastRemote, setLastRemote] = usePersistedState('push.lastRemote');
    const [lastRemoteBranch, setLastRemoteBranch] = usePersistedState('push.lastRemoteBranch');

    // UI state
    const [viewMode, setViewMode] = useState<ViewMode>('commits');
    const [changesViewMode, setChangesViewMode] = useState<'tree' | 'list'>('tree');
    const [commitsViewMode, setCommitsViewMode] = useState<'tree' | 'list'>('tree');
    const [expandedCommitHash, setExpandedCommitHash] = useState<string | null>(null);
    const [activeFile, setActiveFile] = useState<{ path: string; commitHash?: string } | null>(null);

    // Refs
    const scrollAreaRef = useRef<HTMLDivElement>(null);
    const treeRef = useRef<BaseFileTreeRef>(null);

    const [isRemoteBranchesLoading, setIsRemoteBranchesLoading] = useState(false);

    // Initial load
    useEffect(() => {
        (async () => {
            try {
                const initState = await rpc.getPushInitState();

                // Set remotes
                setRemotes(initState.remotes);

                // Determine initial selection
                // 1. If we have persisted values and they are valid, use them
                // 2. Otherwise default to first remote and current branch

                // Current local branch
                setLocalBranch(initState.localBranch);

                if (lastLocalBranch && lastLocalBranch === initState.localBranch) {
                    // Same local branch as last time, try to restore remote/branch
                    // But optimize verification - if we have remotes, check if saved remote is still valid
                    if (lastRemote && initState.remotes.includes(lastRemote)) {
                        setSelectedRemote(lastRemote);
                    } else {
                        setSelectedRemote(initState.remotes[0] || 'origin');
                    }

                    if (lastRemoteBranch) {
                        setSelectedRemoteBranch(lastRemoteBranch);
                    } else {
                        setSelectedRemoteBranch(initState.localBranch);
                    }
                } else {
                    // Different local branch or first time
                    // Default to 'origin' (or first remote) and same branch name
                    const defaultRemote = lastRemote && initState.remotes.includes(lastRemote)
                        ? lastRemote
                        : (initState.remotes[0] || 'origin');

                    setSelectedRemote(defaultRemote);
                    setSelectedRemoteBranch(lastRemoteBranch || initState.localBranch);
                }
            } catch (error) {
                console.error('Failed to load push init state:', error);
            }
        })();
    }, []);

    // Load remote branches when remote changes
    useEffect(() => {
        if (!selectedRemote) return;

        (async () => {
            setIsRemoteBranchesLoading(true);
            try {
                const branches = await rpc.getRemoteBranches(selectedRemote);
                setRemoteBranches(branches);

                // If we don't have a selected remote branch yet, or if the current choice isn't in the list
                // we might want to auto-select. But usually we want to keep what user typed or current local branch name.
                // So here we primarily update the suggestions list.

                if (!selectedRemoteBranch) {
                    if (localBranch && branches.includes(localBranch)) {
                        setSelectedRemoteBranch(localBranch);
                    } else if (branches.length > 0) {
                        // Optional: select first available, or keep empty
                        setSelectedRemoteBranch(branches[0]);
                    }
                }
            } catch (error) {
                console.error('Failed to load remote branches:', error);
            } finally {
                setIsRemoteBranchesLoading(false);
            }
        })();
    }, [selectedRemote, localBranch]);

    // Persist branch selection
    useEffect(() => {
        if (localBranch) {
            setLastLocalBranch(localBranch);
        }
    }, [localBranch]);

    useEffect(() => {
        if (selectedRemote) {
            setLastRemote(selectedRemote);
        }
    }, [selectedRemote]);

    useEffect(() => {
        if (selectedRemoteBranch) {
            setLastRemoteBranch(selectedRemoteBranch);
        }
    }, [selectedRemoteBranch]);

    // Load commits when branch selection changes
    useEffect(() => {
        if (!selectedRemote || !selectedRemoteBranch) return;

        const loadCommits = async () => {
            try {
                // Reset hasMore when branch changes
                setHasMore(false);
                const data = await rpc.getPushCommits({
                    remote: selectedRemote,
                    branch: selectedRemoteBranch,
                    limit: PAGE_SIZE,
                    skip: 0
                });
                setCommits(data.commits);
                setHasMore(data.hasMore);
                setTotalCommits(data.totalCount);
            } catch (error) {
                console.error('Failed to load push commits:', error);
            }
        };

        loadCommits();
    }, [selectedRemote, selectedRemoteBranch]);

    // Handlers
    const handleRemoteChange = useCallback((remote: string) => {
        setSelectedRemote(remote);
    }, []);

    const handleRemoteBranchChange = useCallback((branch: string) => {
        setSelectedRemoteBranch(branch);
    }, []);

    const handlePush = async (options: PushOptions) => {
        setPushError(null);
        setPushStatus('pushing');
        try {
            await rpc.push({
                force: options.force,
                pushTags: options.tags,
                noVerify: options.noVerify,
                remote: selectedRemote,
                branch: selectedRemoteBranch
            });
            setPushStatus('success');

            // Refresh commits after successful push
            const data = await rpc.getPushCommits({
                remote: selectedRemote,
                branch: selectedRemoteBranch,
                limit: PAGE_SIZE,
                skip: 0
            });
            setCommits(data.commits);
            setHasMore(data.hasMore);
            setTotalCommits(data.totalCount);

            // Refetch remote branches to update "NEW" status
            try {
                setIsRemoteBranchesLoading(true);
                const branches = await rpc.getRemoteBranches(selectedRemote);
                setRemoteBranches(branches);
            } catch (error) {
                console.error('Failed to refresh remote branches:', error);
            } finally {
                setIsRemoteBranchesLoading(false);
            }

            // Reset to idle after 2 seconds
            setTimeout(() => setPushStatus('idle'), 2000);
        } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            setPushError(t('Push failed: {{message}}', { message: errMsg }));
            setPushStatus('error');
        }
    };

    const handleLoadMore = async () => {
        if (!selectedRemote || !selectedRemoteBranch || isLoadingMore) return;

        setIsLoadingMore(true);
        try {
            const currentCount = commits.length;
            const data = await rpc.getPushCommits({
                remote: selectedRemote,
                branch: selectedRemoteBranch,
                limit: PAGE_SIZE,
                skip: currentCount
            });

            setCommits(prev => [...prev, ...data.commits]);
            setHasMore(data.hasMore);
            // Update total count as it might have changed
            setTotalCommits(data.totalCount);
        } catch (error) {
            console.error('Failed to load more commits:', error);
        } finally {
            setIsLoadingMore(false);
        }
    };

    // Subscribe to activeFile changes from extension (editor file switch)
    useEffect(() => {
        const unsub = rpcEvents.activeFileChange.subscribe(({ path, commitHash }) => {
            console.log('Active file changed:', path, commitHash);
            setActiveFile({ path, commitHash });
        });
        return unsub;
    }, []);

    const openFileDiff = useCallback((path: string, commit: CommitDetails, preserveFocus: boolean) => {
        const file = commit.files.find(f => f.path === path);
        if (!file) return;

        const parentHash = commit.parentHashes.length > 0 ? commit.parentHashes[0] : '';
        let leftRef = parentHash;
        let rightRef = commit.hash;

        if (file.status.startsWith('A')) {
            leftRef = '';
        } else if (file.status.startsWith('D')) {
            rightRef = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
        }

        setActiveFile({ path, commitHash: rightRef });
        rpc.openCommitDiff({ path, leftRef, rightRef, preserveFocus });
    }, []);

    const openAllFilesDiff = useCallback((path: string, preserveFocus: boolean) => {
        if (commits.length === 0) return;

        const firstCommit = commits[commits.length - 1];
        const lastCommit = commits[0];

        const firstParent = firstCommit.parentHashes.length > 0
            ? firstCommit.parentHashes[0]
            : '';

        setActiveFile({ path, commitHash: lastCommit.hash });
        rpc.openCommitDiff({
            path,
            leftRef: firstParent,
            rightRef: lastCommit.hash,
            preserveFocus
        });
    }, [commits]);

    const toggleCommit = useCallback((hash: string) => {
        setExpandedCommitHash(prev => prev === hash ? null : hash);
    }, []);

    // Memoized values
    const allFiles = useMemo(() => {
        const fileMap = new Map<string, FileStatus>();
        commits.forEach(commit => {
            commit.files.forEach(f => {
                fileMap.set(f.path, { path: f.path, status: f.status, staged: false });
            });
        });
        return Array.from(fileMap.values());
    }, [commits]);

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
                onToggleView={() => setViewMode(m => m === 'commits' ? 'changes' : 'commits')}
                onRemoteChange={handleRemoteChange}
                onRemoteBranchChange={handleRemoteBranchChange}
            />

            {/* Scroll Area */}
            <div className={styles.scrollArea} ref={scrollAreaRef} tabIndex={0}>
                {viewMode === 'commits' && commits.map(commit => (
                    <CommitAccordionItem
                        key={commit.hash}
                        commit={commit}
                        isExpanded={expandedCommitHash === commit.hash}
                        onToggle={() => toggleCommit(commit.hash)}
                        onFileClick={(path) => openFileDiff(path, commit, true)}
                        onFileDoubleClick={(path) => openFileDiff(path, commit, false)}
                        formatRelativeDate={formatRelativeDate}
                        fileViewMode={commitsViewMode}
                        onFileViewModeChange={setCommitsViewMode}
                        activeFile={activeFile}
                    />
                ))}

                {/* Load More Button */}
                {viewMode === 'commits' && hasMore && (
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

                {viewMode === 'changes' && (
                    <div className={styles.changesSection}>
                        <div className={styles.changesHeader}>
                            <span className={styles.changesDescription}>
                                {t('Aggregated changes from all {{count}} pending commits.', { count: commits.length })}
                            </span>
                        </div>
                        <div className={styles.filesHeader}>
                            <span className={styles.filesCount}>
                                {t('{{count}} files', { count: allFiles.length })}
                            </span>
                            <div className={styles.filesActions}>
                                <ViewModeToggle viewMode={changesViewMode} onChange={setChangesViewMode} />
                                <button
                                    className={styles.iconBtn}
                                    onClick={() => treeRef.current?.expandAll()}
                                    title={t('Expand All')}
                                >
                                    <i className="codicon codicon-expand-all" />
                                </button>
                                <button
                                    className={styles.iconBtn}
                                    onClick={() => treeRef.current?.collapseAll()}
                                    title={t('Collapse All')}
                                >
                                    <i className="codicon codicon-collapse-all" />
                                </button>
                            </div>
                        </div>
                        <div className={styles.filesTreeWrapper}>
                            <BaseFileTree
                                ref={treeRef}
                                items={allFiles}
                                viewMode={changesViewMode}
                                readonly={true}
                                onFileClick={(path) => openAllFilesDiff(path, true)}
                                selectedFiles={new Set()}
                                activeFile={activeFile?.path ?? null}
                                onToggleFile={() => { }}
                                onFileDoubleClick={(path) => openAllFilesDiff(path, false)}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Footer */}
            <PushFooter
                commitCount={totalCommits}
                pushStatus={pushStatus}
                error={pushError}
                onPush={handlePush}
                onDismissError={() => setPushError(null)}
            />
        </div>
    );
}
