import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import styles from './LogListPanel.module.css';

import { computeGraph, LONG_DISTANCE_THRESHOLD } from './graphUtils';
import type { GraphLine } from './graphUtils';
import { GraphColumn, CELL_WIDTH } from './GraphColumn';
import { FilterToolbar } from './filter-toolbar/FilterToolbar';
import { RefLabels } from '../common/RefLabels';
import { useLogCommitLoader } from './hooks/useLogCommitLoader';
import { useCommitSelection } from './hooks/useCommitSelection';
import { formatRelativeDate } from '../../utils/dateUtils';
import { BaseFileTree } from '../file-tree/BaseFileTree';
import type { BaseFileTreeRef } from '../file-tree/BaseFileTree';
import { ViewModeToggle } from '../common/ViewModeToggle';
import { usePersistedState } from '../../hooks/usePersistedState';
import type { CommitDetails, FileStatus, LogOptions } from '@shared/messages';
import { rpc, rpcEvents } from '../../lib/rpc_client';
import type { GitLogCommitContext } from '@shared/webviewContext';
import { useTranslation } from 'react-i18next';

interface LogListPanelProps {
    onSelectionChange?: (commits: string[]) => void;
    externalBranchFilter?: { branch: string; requestId: number };
    isNarrowMode?: boolean;
    commitDetails?: CommitDetails;
    repositoryPath?: string;
}

const ROW_HEIGHT = 24;
const INLINE_LOADING_HEIGHT = 72;
const INLINE_BODY_LINE_HEIGHT = 17;
const INLINE_FILE_ROW_HEIGHT = 22;
const INLINE_FILES_HEADER_HEIGHT = 30;
const INLINE_MAX_FILE_ROWS = 8;
const INLINE_MAX_DETAILS_HEIGHT = 320;
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

function estimateWrappedLineCount(text: string): number {
    const trimmed = text.trim();
    if (!trimmed) return 0;

    return trimmed
        .split(/\r?\n/)
        .reduce((count, line) => count + Math.max(1, Math.ceil(line.length / 88)), 0);
}

function getInlineDetailsHeight(commit?: CommitDetails): number {
    if (!commit) return INLINE_LOADING_HEIGHT;

    const bodyLines = Math.min(4, estimateWrappedLineCount(commit.body));
    const bodyHeight = bodyLines > 0 ? bodyLines * INLINE_BODY_LINE_HEIGHT + 7 : 0;
    const summaryHeight = 8 + bodyHeight + 16 + 7 + 1;
    const fileRows = Math.max(1, Math.min(INLINE_MAX_FILE_ROWS, commit.files.length));
    const filesHeight = INLINE_FILES_HEADER_HEIGHT + fileRows * INLINE_FILE_ROW_HEIGHT;

    return Math.min(INLINE_MAX_DETAILS_HEIGHT, summaryHeight + filesHeight);
}

interface InlineGraphLinesProps {
    lines: GraphLine[];
    graphWidth: number;
    height: number;
    nodeColumn: number;
    rowIndex: number;
}

const InlineGraphLines: React.FC<InlineGraphLinesProps> = ({
    lines,
    graphWidth,
    height,
    nodeColumn,
    rowIndex
}) => {
    const continuationLines = lines.filter(line => line.y2 === 1);
    if (continuationLines.length === 0) return null;

    return (
        <svg
            className={styles.inlineGraphSvg}
            width={graphWidth}
            height={height + 2}
            aria-hidden="true"
        >
            {continuationLines.map((line, index) => {
                const x = line.x2 * CELL_WIDTH + CELL_WIDTH / 2;
                const isNodeLine = line.x1 === nodeColumn || line.x2 === nodeColumn;
                return (
                    <path
                        key={`${line.x2}-${index}`}
                        d={`M ${x} 0 L ${x} ${height + 2}`}
                        stroke={line.color}
                        strokeWidth={isNodeLine ? 3 : 2}
                        fill="none"
                        strokeLinecap={line.isDashed ? 'butt' : 'round'}
                        strokeDasharray={line.isDashed ? '2 3' : undefined}
                        strokeDashoffset={line.isDashed ? ((rowIndex + 1) * ROW_HEIGHT) % 5 : undefined}
                    />
                );
            })}
        </svg>
    );
};

interface InlineCommitDetailsProps {
    selectedHash: string;
    commit?: CommitDetails;
}

const InlineCommitDetails: React.FC<InlineCommitDetailsProps> = ({ selectedHash, commit }) => {
    const { t } = useTranslation();
    const treeRef = useRef<BaseFileTreeRef>(null);
    const [fileViewMode, setFileViewMode] = useState<'tree' | 'list'>('list');
    const isLoadedCommit = commit?.hash === selectedHash;

    const fileItems: FileStatus[] = useMemo(() => {
        if (!isLoadedCommit) return [];
        return commit.files.map(file => ({
            path: file.path,
            displayPath: file.displayPath,
            status: file.status,
            staged: false
        }));
    }, [commit, isLoadedCommit]);

    const openFile = useCallback((path: string, preserveFocus: boolean) => {
        if (!isLoadedCommit) return;
        const file = commit.files.find(item => item.path === path);
        if (!file) return;

        const parentHash = commit.parentHashes.length > 0 ? commit.parentHashes[0] : '';
        let leftRef = parentHash;
        let rightRef = commit.hash;

        if (file.status.startsWith('A')) {
            leftRef = '';
        } else if (file.status.startsWith('D')) {
            rightRef = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
        }

        rpc.openCommitDiff({ path, leftRef, rightRef, preserveFocus });
    }, [commit, isLoadedCommit]);

    if (!isLoadedCommit) {
        return (
            <div className={styles.inlineLoading}>
                <i className="codicon codicon-loading" aria-hidden="true" />
                <span>{t('Loading...')}</span>
            </div>
        );
    }

    const bodyText = commit.body.trim();
    const statsLabel = `+${commit.stats.additions} -${commit.stats.deletions}`;

    return (
        <div className={styles.inlineDetailsContent}>
            <div className={styles.inlineSummary}>
                {bodyText && (
                    <div className={styles.inlineBody}>{bodyText}</div>
                )}
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
            </div>
            <div className={styles.inlineFiles}>
                <div className={styles.inlineFilesHeader}>
                    <span className={styles.inlineFilesCount}>
                        {t('{{count}} files', { count: commit.files.length })}
                    </span>
                    <div className={styles.inlineFilesActions}>
                        <ViewModeToggle viewMode={fileViewMode} onChange={setFileViewMode} />
                        <button
                            className={styles.inlineIconButton}
                            type="button"
                            onClick={() => treeRef.current?.expandAll()}
                            title={t('Expand All')}
                        >
                            <i className="codicon codicon-expand-all" aria-hidden="true" />
                        </button>
                        <button
                            className={styles.inlineIconButton}
                            type="button"
                            onClick={() => treeRef.current?.collapseAll()}
                            title={t('Collapse All')}
                        >
                            <i className="codicon codicon-collapse-all" aria-hidden="true" />
                        </button>
                    </div>
                </div>
                <div className={styles.inlineFilesTree}>
                    <BaseFileTree
                        ref={treeRef}
                        items={fileItems}
                        viewMode={fileViewMode}
                        readonly={true}
                        onFileClick={(path) => openFile(path, true)}
                        onFileDoubleClick={(path) => openFile(path, false)}
                        selectedFiles={new Set()}
                        activeFile={null}
                        onToggleFile={() => { }}
                        contextMenuSection="gitLogCommitFile"
                        contextMenuData={{
                            commitHash: commit.hash,
                            parentHash: commit.parentHashes[0] || ''
                        }}
                        stickyHeaders={true}
                    />
                </div>
            </div>
        </div>
    );
};

export const LogListPanel: React.FC<LogListPanelProps> = ({
    onSelectionChange,
    externalBranchFilter,
    isNarrowMode = false,
    commitDetails,
    repositoryPath
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

    const {
        commits,
        loading,
        hasMore,
        filters,
        unpushedCommits,
        latestUnpushedHash,
        loadMore,
        setFilters
    } = useLogCommitLoader(repositoryPath);

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

    const getRowTop = useCallback((index: number) => {
        return index * ROW_HEIGHT + (expandedLayout.offsets[index] ?? 0);
    }, [expandedLayout]);

    const scrollToRow = useCallback((index: number) => {
        if (!containerRef.current) return;

        const centerOffset = clientHeight / 2 - ROW_HEIGHT / 2;
        containerRef.current.scrollTop = Math.max(0, getRowTop(index) - centerOffset);
    }, [clientHeight, getRowTop]);

    const [cachedSelectedHashes, setCachedSelectedHashes] = usePersistedState('gitLog.selectedHashes');

    const {
        lastSelectedRef,
        blinkHash,
        handleRowClick,
        handleJumpToCommit,
        isSelected,
        setSelectedCommits
    } = useCommitSelection({
        commits,
        onSelectionChange,
        scrollToRow,
        initialSelection: cachedSelectedHashes,
        onSelectionPersist: setCachedSelectedHashes
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
                setExpandedCommitDetailsByHash(current => ({ ...current, [hash]: commitDetails }));
                continue;
            }

            rpc.getCommitDetails(hash)
                .then(details => {
                    if (!cancelled) {
                        setExpandedCommitDetailsByHash(current => ({ ...current, [hash]: details }));
                    }
                })
                .catch(error => {
                    console.error('Failed to load expanded Git Log commit details', error);
                });
        }

        return () => {
            cancelled = true;
        };
    }, [commitDetails, expandedCommitDetailsByHash, expandedHashes, isNarrowMode]);

    useEffect(() => {
        if (!commitDetails || !expandedHashes.has(commitDetails.hash)) return;
        setExpandedCommitDetailsByHash(current => ({ ...current, [commitDetails.hash]: commitDetails }));
    }, [commitDetails, expandedHashes]);

    useEffect(() => {
        if (expandedHashes.size === 0) return;

        const visibleHashes = new Set(commits.map(commit => commit.hash));
        setExpandedHashes(current => {
            const next = new Set([...current].filter(hash => visibleHashes.has(hash)));
            return next.size === current.size ? current : next;
        });
    }, [commits, expandedHashes.size]);

    useEffect(() => {
        let cancelled = false;
        rpc.getPendingGitLogReveal()
            .then(params => {
                if (!cancelled && params) {
                    rpcEvents.revealLog.emit(params);
                }
            })
            .catch(error => {
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
            const index = commits.findIndex(c => c.hash === hash);
            if (index !== -1) {
                handleJumpToCommit(hash);
                pendingRevealHashRef.current = null;
            }
        });
    }, [commits, handleJumpToCommit, setCachedScrollTop]);

    useEffect(() => {
        const hash = pendingRevealHashRef.current;
        if (!hash) return;

        const index = commits.findIndex(c => c.hash === hash);
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
        const observer = new ResizeObserver(entries => {
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

        const index = commits.findIndex(commit => commit.hash === hash);
        if (index === -1) return;

        const inlineDetailsHeight = expandedLayout.heightByHash.get(hash) ?? INLINE_LOADING_HEIGHT;
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
        const visibleEndRow = Math.ceil((target.scrollTop + target.clientHeight) / ROW_HEIGHT);
        const remainingRows = commits.length - visibleEndRow;
        if (hasMore && !loading && remainingRows < LONG_DISTANCE_THRESHOLD + 10) {
            loadMore();
        }
    };

    const toggleInlineDetails = (commit: typeof commits[number]) => {
        if (!isNarrowMode) return;

        setFocusedHash(commit.hash);
        setExpandedHashes(current => {
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

    const handleRowClickWithAccordion = (e: React.MouseEvent<HTMLDivElement>, commit: typeof commits[number]) => {
        setFocusedHash(commit.hash);
        handleRowClick(e, commit);

        if (!isNarrowMode || e.metaKey || e.ctrlKey || e.shiftKey) return;
        toggleInlineDetails(commit);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (commits.length === 0) return;

        let newIndex: number;

        const currentIndex = lastSelectedRef.current
            ? commits.findIndex(c => c.hash === lastSelectedRef.current)
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
                const rowBottom = rowTop + ROW_HEIGHT;
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
            const blockBottom = getRowTop(index) + ROW_HEIGHT + (expandedLayout.heightByHash.get(commit.hash) ?? 0);
            if (blockBottom >= overscanTop) {
                return Math.max(0, index - BUFFER);
            }
        }
        return Math.max(0, commits.length - BUFFER);
    }, [commits, expandedLayout, getRowTop, scrollTop]);
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
    const showEmptyResult = commits.length === 0 && !loading;

    return (
        <div className={styles.container}>
            <div className={styles.mainContent}>
                <FilterToolbar onFilterChange={setFilters} externalBranch={externalBranchFilter} />

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
                    {showEmptyResult ? (
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
                                const detailsContentLeft = 8 + rowGraphWidth + 8;
                                const detailsShellLeft = Math.max(0, detailsContentLeft - 12);
                                const detailsId = `git-log-inline-details-${commit.hash}`;
                                return (
                                    <React.Fragment key={commit.hash}>
                                        <div
                                            className={`${styles.row} ${isExpanded ? styles.expandedRow : ''} ${!isBlink && selected ? styles.selected : ''} ${isBlink ? styles.blink : ''} ${focusedHash === commit.hash ? styles.focused : ''}`}
                                            style={{
                                                position: 'absolute',
                                                top: rowTop,
                                                left: 0,
                                                right: 0
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
                                                isLatestUnpushed: commit.hash === latestUnpushedHash
                                            } satisfies GitLogCommitContext)}
                                        >
                                            <div className={styles.graphCol} style={{ width: rowGraphWidth }}>
                                                {graphNode && (
                                                    <GraphColumn
                                                        node={graphNode}
                                                        rowHeight={ROW_HEIGHT}
                                                        graphWidth={rowGraphWidth}
                                                        rowIndex={globalIndex}
                                                        onJumpToCommit={handleJumpToCommit}
                                                        isSelected={selected && !isBlink}
                                                        isHovered={rowHoveredHash === commit.hash}
                                                        hasFocus={listHasFocus}
                                                        isExpanded={isExpanded}
                                                    />
                                                )}
                                            </div>
                                            <div className={styles.subject}>
                                                <span>{commit.subject}</span>
                                                {commit.refs && commit.refs.length > 0 && (
                                                    <RefLabels refs={commit.refs} />
                                                )}
                                            </div>
                                            <span className={styles.author}>{commit.authorName}</span>
                                            <span className={styles.date}>
                                                {formatRelativeDate(commit.date)}
                                            </span>
                                        </div>
                                        {isExpanded && (
                                            <div
                                                id={detailsId}
                                                className={styles.inlineDetails}
                                                style={{
                                                    top: rowTop + ROW_HEIGHT,
                                                    height: inlineDetailsHeight
                                                }}
                                            >
                                                {graphNode && (
                                                    <InlineGraphLines
                                                        lines={graphNode.lines}
                                                        graphWidth={rowGraphWidth}
                                                        height={inlineDetailsHeight}
                                                        nodeColumn={graphNode.column}
                                                        rowIndex={globalIndex}
                                                    />
                                                )}
                                                <div
                                                    className={styles.inlineDetailsShell}
                                                    style={{ marginLeft: detailsShellLeft }}
                                                >
                                                    <InlineCommitDetails
                                                        selectedHash={commit.hash}
                                                        commit={expandedCommitDetailsByHash[commit.hash]}
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
