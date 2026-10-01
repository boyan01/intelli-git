import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import styles from './LogListPanel.module.css';

import { computeGraph, LONG_DISTANCE_THRESHOLD } from './graphUtils';
import { GraphColumn, CELL_WIDTH } from './GraphColumn';
import { FilterToolbar } from './filter-toolbar/FilterToolbar';
import { LoadingProgressBar } from '../common/LoadingProgressBar';
import { RefLabels } from '../common/RefLabels';
import { useLogCommitLoader } from './hooks/useLogCommitLoader';
import { useCommitSelection } from './hooks/useCommitSelection';
import { formatRelativeDate } from '../../utils/dateUtils';
import { usePersistedState } from '../../hooks/usePersistedState';
import type { CommitDetails, LogOptions } from '@shared/messages';
import { rpc, rpcEvents } from '../../lib/rpc_client';
import type { GitLogCommitContext } from '@shared/webviewContext';
import { useTranslation } from 'react-i18next';
import { getInlineDetailsHeight, getInlineFileSummary } from './inlineCommitLayout';

interface LogListPanelProps {
    onSelectionChange?: (commits: string[]) => void;
    externalBranchFilter?: { branch: string; requestId: number };
    isNarrowMode?: boolean;
    commitDetails?: CommitDetails;
    repositoryPath?: string;
}

const ROW_HEIGHT = 24;
const BUFFER = 10;

function hasActiveFilters(filters: Partial<LogOptions>): boolean {
    return Boolean(
        filters.branch ||
        filters.search ||
        filters.regexMode ||
        filters.caseSensitive ||
        (filters.authors && filters.authors.length > 0) ||
        (filters.paths && filters.paths.length > 0) ||
        filters.since ||
        filters.until
    );
}

interface InlineCommitDetailsProps {
    selectedHash: string;
    commit?: CommitDetails;
}

const InlineCommitDetails: React.FC<InlineCommitDetailsProps> = ({ selectedHash, commit }) => {
    const { t } = useTranslation();
    const isLoadedCommit = commit?.hash === selectedHash;

    if (!isLoadedCommit) {
        return (
            <div className={styles.inlineLoading}>
                <span>{t('Loading...')}</span>
            </div>
        );
    }

    const bodyText = commit.body.trim();
    const statsLabel = `+${commit.stats.additions} -${commit.stats.deletions}`;
    const fileSummary = getInlineFileSummary(commit.files);

    return (
        <div className={styles.inlineDetailsContent}>
            {bodyText && <div className={styles.inlineBody}>{bodyText}</div>}
            <div className={styles.inlineMeta}>
                <span title={commit.authorEmail}>
                    <i className="codicon codicon-person" aria-hidden="true" />
                    {commit.authorName}
                </span>
                <span>
                    <i className="codicon codicon-git-commit" aria-hidden="true" />
                    {commit.shortHash}
                </span>
                <span title={new Date(commit.date).toLocaleString()}>
                    <i className="codicon codicon-calendar" aria-hidden="true" />
                    {formatRelativeDate(commit.date)}
                </span>
                <span className={styles.inlineStats}>{statsLabel}</span>
            </div>
            {fileSummary.totalCount > 0 && (
                <div className={styles.inlineFilesSummary}>
                    <i className="codicon codicon-files" aria-hidden="true" />
                    <span className={styles.inlineFilesCount}>
                        {t('{{count}} files', { count: fileSummary.totalCount })}:
                    </span>
                    <span className={styles.inlineFilePaths}>{fileSummary.visibleFiles.join(', ')}</span>
                    {fileSummary.moreCount > 0 && (
                        <span className={styles.inlineMoreFiles}>
                            {t('+{{count}} more', { count: fileSummary.moreCount })}
                        </span>
                    )}
                </div>
            )}
        </div>
    );
};

export const LogListPanel: React.FC<LogListPanelProps> = ({
    onSelectionChange,
    externalBranchFilter,
    isNarrowMode = false,
    commitDetails,
    repositoryPath,
}) => {
    const { t } = useTranslation();
    const containerRef = useRef<HTMLDivElement>(null);
    const [cachedScrollTop, setCachedScrollTop] = usePersistedState('gitLog.scrollTop');
    const hasRestoredScroll = useRef(false);
    const [scrollTop, setScrollTop] = useState(cachedScrollTop);
    const [clientHeight, setClientHeight] = useState(0);
    const [focusedHash, setFocusedHash] = useState<string | null>(null);
    const [rowHoveredHash, setRowHoveredHash] = useState<string | null>(null);
    const [listHasFocus, setListHasFocus] = useState(false);
    const [expandedHashes, setExpandedHashes] = useState<Set<string>>(() => new Set());
    const [expandedCommitDetailsByHash, setExpandedCommitDetailsByHash] = useState<Record<string, CommitDetails>>({});
    const lastToggledHashRef = useRef<string | null>(null);

    const { commits, loading, hasMore, filters, unpushedCommits, latestUnpushedHash, loadMore, setFilters } =
        useLogCommitLoader(repositoryPath);

    const expandedLayout = useMemo(() => {
        const offsets: number[] = [];
        const heightByHash = new Map<string, number>();
        let totalExtraHeight = 0;

        commits.forEach((commit, index) => {
            offsets[index] = totalExtraHeight;
            if (isNarrowMode && expandedHashes.has(commit.hash)) {
                const height = getInlineDetailsHeight(expandedCommitDetailsByHash[commit.hash]);
                heightByHash.set(commit.hash, height);
                totalExtraHeight += height;
            }
        });

        return { offsets, heightByHash, totalExtraHeight };
    }, [commits, expandedCommitDetailsByHash, expandedHashes, isNarrowMode]);

    const getRowTop = useCallback(
        (index: number) => {
            return index * ROW_HEIGHT + (expandedLayout.offsets[index] ?? 0);
        },
        [expandedLayout]
    );

    const getCommitBlockHeight = useCallback(
        (commit: (typeof commits)[number]) => {
            return ROW_HEIGHT + (expandedLayout.heightByHash.get(commit.hash) ?? 0);
        },
        [expandedLayout]
    );

    const getFirstIndexAfterOffset = useCallback(
        (offset: number) => {
            for (let index = 0; index < commits.length; index += 1) {
                if (getRowTop(index) > offset) {
                    return index;
                }
            }
            return commits.length;
        },
        [commits.length, getRowTop]
    );

    const scrollToRow = useCallback(
        (index: number) => {
            if (!containerRef.current) return;

            const centerOffset = clientHeight / 2 - ROW_HEIGHT / 2;
            containerRef.current.scrollTop = Math.max(0, getRowTop(index) - centerOffset);
        },
        [clientHeight, getRowTop]
    );

    const [cachedSelectedHashes, setCachedSelectedHashes] = usePersistedState('gitLog.selectedHashes');

    const { lastSelectedRef, blinkHash, handleRowClick, handleJumpToCommit, isSelected, setSelectedCommits } =
        useCommitSelection({
            commits,
            onSelectionChange,
            scrollToRow,
            initialSelection: cachedSelectedHashes,
            onSelectionPersist: setCachedSelectedHashes,
        });
    const pendingRevealHashRef = useRef<string | null>(null);

    useEffect(() => {
        setSelectedCommits([]);
        onSelectionChange?.([]);
        setCachedSelectedHashes([]);
        lastSelectedRef.current = null;
        setFocusedHash(null);
        setExpandedHashes(new Set());
        setExpandedCommitDetailsByHash({});
    }, [repositoryPath, setCachedSelectedHashes, setSelectedCommits, onSelectionChange, lastSelectedRef]);

    useEffect(() => {
        if (!isNarrowMode || expandedHashes.size === 0) return;

        let cancelled = false;

        for (const hash of expandedHashes) {
            if (expandedCommitDetailsByHash[hash]?.hash === hash) continue;
            if (commitDetails?.hash === hash) {
                setExpandedCommitDetailsByHash((current) => ({ ...current, [hash]: commitDetails }));
                continue;
            }

            rpc.getCommitDetails(hash)
                .then((details) => {
                    if (!cancelled) {
                        setExpandedCommitDetailsByHash((current) => ({ ...current, [hash]: details }));
                    }
                })
                .catch((error) => {
                    console.error('Failed to load expanded Git Log commit details', error);
                });
        }

        return () => {
            cancelled = true;
        };
    }, [commitDetails, expandedCommitDetailsByHash, expandedHashes, isNarrowMode]);

    useEffect(() => {
        if (!commitDetails || !expandedHashes.has(commitDetails.hash)) return;
        setExpandedCommitDetailsByHash((current) => ({ ...current, [commitDetails.hash]: commitDetails }));
    }, [commitDetails, expandedHashes]);

    useEffect(() => {
        if (expandedHashes.size === 0) return;

        const visibleHashes = new Set(commits.map((commit) => commit.hash));
        setExpandedHashes((current) => {
            const next = new Set([...current].filter((hash) => visibleHashes.has(hash)));
            return next.size === current.size ? current : next;
        });
    }, [commits, expandedHashes.size]);

    useEffect(() => {
        let cancelled = false;
        rpc.getPendingGitLogReveal()
            .then((params) => {
                if (!cancelled && params) {
                    rpcEvents.revealLog.emit(params);
                }
            })
            .catch((error) => {
                console.error('Failed to consume pending Git Log reveal', error);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        return rpcEvents.revealLog.subscribe(({ hash }) => {
            if (!hash) {
                pendingRevealHashRef.current = null;
                if (containerRef.current) {
                    containerRef.current.scrollTop = 0;
                }
                setCachedScrollTop(0);
                setScrollTop(0);
                return;
            }

            pendingRevealHashRef.current = hash;
            const index = commits.findIndex((c) => c.hash === hash);
            if (index !== -1) {
                handleJumpToCommit(hash);
                pendingRevealHashRef.current = null;
            }
        });
    }, [commits, handleJumpToCommit, setCachedScrollTop]);

    useEffect(() => {
        const hash = pendingRevealHashRef.current;
        if (!hash) return;

        const index = commits.findIndex((c) => c.hash === hash);
        if (index === -1) return;

        handleJumpToCommit(hash);
        pendingRevealHashRef.current = null;
    }, [commits, handleJumpToCommit]);

    // Compute graph data
    const preferDefaultBranchLane = !filters.branch;
    const graph = useMemo(
        () => computeGraph(commits, hasMore, { preferDefaultBranchLane }),
        [commits, hasMore, preferDefaultBranchLane]
    );

    useEffect(() => {
        if (!containerRef.current) return;
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setClientHeight(entry.contentRect.height);
            }
        });
        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const hash = lastToggledHashRef.current;
        if (!hash || !expandedHashes.has(hash) || !containerRef.current) return;

        const index = commits.findIndex((commit) => commit.hash === hash);
        if (index === -1) return;

        const inlineDetailsHeight = expandedLayout.heightByHash.get(hash) ?? getInlineDetailsHeight();
        const rowTop = getRowTop(index);
        const detailsBottom = rowTop + ROW_HEIGHT + inlineDetailsHeight;
        const viewTop = containerRef.current.scrollTop;
        const viewBottom = viewTop + clientHeight;

        if (rowTop < viewTop || ROW_HEIGHT + inlineDetailsHeight > clientHeight) {
            containerRef.current.scrollTop = rowTop;
        } else if (detailsBottom > viewBottom) {
            containerRef.current.scrollTop = Math.max(0, detailsBottom - clientHeight);
        }
    }, [clientHeight, commits, expandedHashes, expandedLayout, getRowTop]);

    // Restore scroll position after component mounts and has cached commits
    useEffect(() => {
        if (!hasRestoredScroll.current && containerRef.current && cachedScrollTop > 0 && commits.length > 0) {
            containerRef.current.scrollTop = cachedScrollTop;
            hasRestoredScroll.current = true;
        }
    }, [commits.length, cachedScrollTop]);

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const target = e.currentTarget;
        setScrollTop(target.scrollTop);
        setCachedScrollTop(target.scrollTop);

        // Preload when less than 30 rows remain (LONG_DISTANCE_THRESHOLD)
        const visibleEndIndex = getFirstIndexAfterOffset(target.scrollTop + target.clientHeight);
        const remainingRows = commits.length - visibleEndIndex;
        if (hasMore && !loading && remainingRows < LONG_DISTANCE_THRESHOLD + 10) {
            loadMore();
        }
    };

    const toggleInlineDetails = (commit: (typeof commits)[number]) => {
        if (!isNarrowMode) return;

        setFocusedHash(commit.hash);
        setExpandedHashes((current) => {
            const next = new Set(current);
            if (next.has(commit.hash)) {
                next.delete(commit.hash);
            } else {
                next.add(commit.hash);
                lastToggledHashRef.current = commit.hash;
            }
            return next;
        });
    };

    const handleRowClickWithAccordion = (e: React.MouseEvent<HTMLDivElement>, commit: (typeof commits)[number]) => {
        setFocusedHash(commit.hash);
        handleRowClick(e, commit);

        if (!isNarrowMode || e.metaKey || e.ctrlKey || e.shiftKey) return;
        toggleInlineDetails(commit);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (commits.length === 0) return;

        let newIndex: number;

        const currentIndex = lastSelectedRef.current
            ? commits.findIndex((c) => c.hash === lastSelectedRef.current)
            : -1;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            newIndex = currentIndex + 1;
            if (newIndex >= commits.length) newIndex = commits.length - 1;
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            newIndex = currentIndex - 1;
            if (newIndex < 0) newIndex = 0;
        } else {
            return;
        }

        if (newIndex !== currentIndex) {
            const newHash = commits[newIndex].hash;
            setSelectedCommits([newHash]);
            onSelectionChange?.([newHash]);
            lastSelectedRef.current = newHash;

            // Ensure visible
            if (containerRef.current) {
                const rowTop = getRowTop(newIndex);
                const rowBottom = rowTop + getCommitBlockHeight(commits[newIndex]);
                const viewTop = containerRef.current.scrollTop;
                const viewBottom = viewTop + clientHeight;

                if (rowTop < viewTop) {
                    containerRef.current.scrollTop = rowTop;
                } else if (rowBottom > viewBottom) {
                    containerRef.current.scrollTop = rowBottom - clientHeight;
                }
            }
        }
    };

    // Virtual scroll calculations
    const totalHeight = commits.length * ROW_HEIGHT + expandedLayout.totalExtraHeight;
    const startIndex = useMemo(() => {
        const overscanTop = Math.max(0, scrollTop - BUFFER * ROW_HEIGHT);
        for (let index = 0; index < commits.length; index += 1) {
            const commit = commits[index];
            const blockBottom = getRowTop(index) + getCommitBlockHeight(commit);
            if (blockBottom >= overscanTop) {
                return Math.max(0, index - BUFFER);
            }
        }
        return Math.max(0, commits.length - BUFFER);
    }, [commits, getCommitBlockHeight, getRowTop, scrollTop]);
    const endIndex = useMemo(() => {
        const overscanBottom = scrollTop + clientHeight + BUFFER * ROW_HEIGHT;
        let index = startIndex;
        while (index < commits.length && getRowTop(index) <= overscanBottom) {
            index += 1;
        }
        return Math.min(commits.length, index + BUFFER);
    }, [clientHeight, commits.length, getRowTop, scrollTop, startIndex]);

    const visibleCommits = commits.slice(startIndex, endIndex);
    const hasFilters = hasActiveFilters(filters);
    const showLoadingFirstPage = commits.length === 0 && loading;
    const showEmptyResult = commits.length === 0 && !loading;

    return (
        <div className={styles.container}>
            <div className={styles.mainContent}>
                <FilterToolbar
                    onFilterChange={setFilters}
                    externalBranch={externalBranchFilter}
                    repositoryPath={repositoryPath}
                />
                <LoadingProgressBar active={loading} ariaLabel={t('Loading...')} />

                <div
                    ref={containerRef}
                    className={styles.list}
                    onScroll={handleScroll}
                    tabIndex={0}
                    onKeyDown={handleKeyDown}
                    onFocus={() => setListHasFocus(true)}
                    onBlur={() => setListHasFocus(false)}
                    style={{ outline: 'none' }}
                >
                    {showLoadingFirstPage ? null : showEmptyResult ? (
                        <div className={styles.emptyState}>
                            <i
                                className={`codicon ${hasFilters ? 'codicon-filter' : 'codicon-git-commit'} ${styles.emptyIcon}`}
                                aria-hidden="true"
                            />
                            <div className={styles.emptyTitle}>
                                {hasFilters ? t('No commits match these filters.') : t('No commits found.')}
                            </div>
                            <div className={styles.emptyDescription}>
                                {hasFilters
                                    ? t('Adjust or clear filters to show more history.')
                                    : t('Fetch or create commits to populate the Git Log.')}
                            </div>
                            <div className={styles.emptyActions}>
                                {hasFilters && (
                                    <button
                                        className={styles.emptyButton}
                                        type="button"
                                        onClick={() => rpcEvents.clearGitLogFilters.emit('all')}
                                    >
                                        {t('Clear All')}
                                    </button>
                                )}
                                {filters.branch && (
                                    <button
                                        className={styles.emptyButton}
                                        type="button"
                                        onClick={() => rpcEvents.clearGitLogFilters.emit('branch')}
                                    >
                                        {t('Show All Branches')}
                                    </button>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div style={{ height: totalHeight, position: 'relative' }}>
                            {visibleCommits.map((commit, i) => {
                                const globalIndex = startIndex + i;
                                const graphNode = graph.get(commit.hash);
                                const selected = isSelected(commit.hash);
                                const isBlink = commit.hash === blinkHash;
                                const rowGraphWidth = graphNode ? (graphNode.maxX + 1) * CELL_WIDTH : CELL_WIDTH;
                                const rowTop = getRowTop(globalIndex);
                                const isExpanded = isNarrowMode && expandedHashes.has(commit.hash);
                                const inlineDetailsHeight = expandedLayout.heightByHash.get(commit.hash) ?? 0;
                                const blockHeight = ROW_HEIGHT + inlineDetailsHeight;
                                return (
                                    <div
                                        key={commit.hash}
                                        className={`${styles.row} ${isExpanded ? styles.expandedRow : ''} ${!isBlink && selected ? styles.selected : ''} ${isBlink ? styles.blink : ''} ${focusedHash === commit.hash ? styles.focused : ''}`}
                                        style={{
                                            position: 'absolute',
                                            top: rowTop,
                                            left: 0,
                                            right: 0,
                                            height: blockHeight,
                                        }}
                                        onClick={(e) => handleRowClickWithAccordion(e, commit)}
                                        onMouseEnter={() => {
                                            setRowHoveredHash(commit.hash);
                                        }}
                                        onMouseLeave={() => {
                                            setRowHoveredHash(null);
                                        }}
                                        onContextMenu={() => setFocusedHash(commit.hash)}
                                        data-vscode-context={JSON.stringify({
                                            webviewSection: 'gitLogCommit',
                                            hash: commit.hash,
                                            shortHash: commit.shortHash,
                                            subject: commit.subject,
                                            isUnpushed: unpushedCommits.has(commit.hash),
                                            isLatestUnpushed: commit.hash === latestUnpushedHash,
                                        } satisfies GitLogCommitContext)}
                                    >
                                        <div
                                            className={styles.graphCol}
                                            style={{ width: rowGraphWidth, height: blockHeight }}
                                        >
                                            {graphNode && (
                                                <GraphColumn
                                                    node={graphNode}
                                                    rowHeight={ROW_HEIGHT}
                                                    graphHeight={blockHeight}
                                                    graphWidth={rowGraphWidth}
                                                    rowIndex={globalIndex}
                                                    rowTop={rowTop}
                                                    onJumpToCommit={handleJumpToCommit}
                                                    isSelected={selected && !isBlink}
                                                    isHovered={rowHoveredHash === commit.hash}
                                                    hasFocus={listHasFocus}
                                                    isExpanded={isExpanded}
                                                />
                                            )}
                                        </div>
                                        <div className={styles.commitContent}>
                                            <div className={styles.rowMain}>
                                                <div className={styles.subject}>
                                                    <span>{commit.subject}</span>
                                                    {commit.refs && commit.refs.length > 0 && (
                                                        <RefLabels refs={commit.refs} />
                                                    )}
                                                </div>
                                                <span className={styles.author}>{commit.authorName}</span>
                                                <span className={styles.date}>{formatRelativeDate(commit.date)}</span>
                                            </div>
                                            {isExpanded && (
                                                <InlineCommitDetails
                                                    selectedHash={commit.hash}
                                                    commit={expandedCommitDetailsByHash[commit.hash]}
                                                />
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
