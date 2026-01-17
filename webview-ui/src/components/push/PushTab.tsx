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
import { PushFooter } from './PushFooter';
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
    const [isPushing, setIsPushing] = useState(false);
    const [pushTags, setPushTags] = useState(false);

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

    // Load initial data
    useEffect(() => {
        const loadInitData = async () => {
            try {
                const initState = await rpc.getPushInitState();
                setLocalBranch(initState.localBranch);
                setRemotes(initState.remotes);

                // Only reset selections when local branch has changed
                const branchChanged = lastLocalBranch && lastLocalBranch !== initState.localBranch;



                if (branchChanged) {
                    // Branch changed, use defaults
                    setSelectedRemote(initState.remotes[0] || 'origin');
                    setSelectedRemoteBranch(initState.localBranch);
                } else {
                    // Same branch (or first time), restore previous selections
                    const remote = (lastRemote && initState.remotes.includes(lastRemote))
                        ? lastRemote
                        : initState.remotes[0] || 'origin';
                    setSelectedRemote(remote);
                    setSelectedRemoteBranch(lastRemoteBranch || initState.localBranch);
                }
            } catch (error) {
                console.error('Failed to load push init state:', error);
            }
        };
        loadInitData();
    }, []);

    // Load remote branches when remote changes
    useEffect(() => {
        if (!selectedRemote) return;

        const loadRemoteBranches = async () => {
            try {
                const branches = await rpc.getRemoteBranches(selectedRemote);
                setRemoteBranches(branches);

                // Only auto-set if no selection exists yet
                if (!selectedRemoteBranch) {
                    if (localBranch && branches.includes(localBranch)) {
                        setSelectedRemoteBranch(localBranch);
                    } else if (branches.length > 0) {
                        setSelectedRemoteBranch(branches[0]);
                    }
                }
                // If selectedRemoteBranch exists (from persistence or user selection), keep it
            } catch (error) {
                console.error('Failed to load remote branches:', error);
            }
        };

        loadRemoteBranches();
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

    const handlePush = async (force: boolean) => {
        setIsPushing(true);
        try {
            await rpc.push({
                force,
                pushTags,
                remote: selectedRemote,
                branch: selectedRemoteBranch
            });
        } catch (e) {
            console.error('Push failed', e);
        } finally {
            setIsPushing(false);
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
                onToggleView={() => setViewMode(v => v === 'commits' ? 'changes' : 'commits')}
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
                isPushing={isPushing}
                pushTags={pushTags}
                onPush={handlePush}
                onPushTagsChange={setPushTags}
            />

            {/* Loading Overlay */}
            {isPushing && <div className={styles.loadingOverlay} />}
        </div>
    );
}
