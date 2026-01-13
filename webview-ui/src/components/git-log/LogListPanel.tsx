import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import styles from './LogListPanel.module.css';

import { computeGraph, LONG_DISTANCE_THRESHOLD } from './graphUtils';
import { GraphColumn, CELL_WIDTH } from './GraphColumn';
import { FilterToolbar } from './filter-toolbar/FilterToolbar';
import { RefLabels } from './RefLabels';
import { useLogCommitLoader } from './hooks/useLogCommitLoader';
import { useCommitSelection } from './hooks/useCommitSelection';
import { formatRelativeDate } from '../../utils/dateUtils';
import { CommitDetailsView } from '../common/CommitDetailsView';
import { usePersistedState } from '../../hooks/usePersistedState';
import type { CommitDetails } from '../../../../shared/messages';

interface LogListPanelProps {
    onSelectionChange?: (commits: string[]) => void;
    externalBranchFilter?: string;
    isNarrowMode?: boolean;
    selectedHashes?: string[];
    commitDetails?: CommitDetails;
}

const ROW_HEIGHT = 24;
const BUFFER = 10;

export const LogListPanel: React.FC<LogListPanelProps> = ({
    onSelectionChange,
    externalBranchFilter,
    isNarrowMode = false,
    selectedHashes: externalSelectedHashes = [],
    commitDetails
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [cachedScrollTop, setCachedScrollTop] = usePersistedState('gitLog.scrollTop');
    const hasRestoredScroll = useRef(false);
    const [scrollTop, setScrollTop] = useState(cachedScrollTop);
    const [clientHeight, setClientHeight] = useState(0);
    const [hoveredHash, setHoveredHash] = useState<string | null>(null);
    const [focusedHash, setFocusedHash] = useState<string | null>(null);
    const [rowHoveredHash, setRowHoveredHash] = useState<string | null>(null);
    const [listHasFocus, setListHasFocus] = useState(false);
    const [isClosing, setIsClosing] = useState(false);
    const [isPanelLocked, setIsPanelLocked] = useState(false);
    const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isPanelHoveredRef = useRef(false);

    const clearAllTimers = useCallback(() => {
        if (hoverTimerRef.current) {
            clearTimeout(hoverTimerRef.current);
            hoverTimerRef.current = null;
        }
        if (hideTimerRef.current) {
            clearTimeout(hideTimerRef.current);
            hideTimerRef.current = null;
        }
    }, []);

    const startShowTimer = useCallback((hash: string) => {
        if (!isNarrowMode) return;
        clearAllTimers();
        hoverTimerRef.current = setTimeout(() => {
            setIsClosing(false);
            setHoveredHash(hash);
        }, 1000);
    }, [isNarrowMode, clearAllTimers]);

    const startHideTimer = useCallback(() => {
        if (isPanelHoveredRef.current || isPanelLocked) return;
        clearAllTimers();
        hideTimerRef.current = setTimeout(() => {
            setIsClosing(true);
            setTimeout(() => {
                setHoveredHash(null);
                setIsClosing(false);
            }, 200);
        }, 500);
    }, [clearAllTimers, isPanelLocked]);

    const handleRowMouseEnter = useCallback((hash: string, selected: boolean) => {
        if (!selected || !isNarrowMode) return;
        startShowTimer(hash);
    }, [isNarrowMode, startShowTimer]);

    const handleRowMouseLeave = useCallback(() => {
        if (hoverTimerRef.current) {
            clearTimeout(hoverTimerRef.current);
            hoverTimerRef.current = null;
        }
        if (hoveredHash) {
            startHideTimer();
        }
    }, [hoveredHash, startHideTimer]);

    const handlePanelMouseEnter = useCallback(() => {
        isPanelHoveredRef.current = true;
        clearAllTimers();
    }, [clearAllTimers]);

    const handlePanelMouseLeave = useCallback(() => {
        isPanelHoveredRef.current = false;
        if (!isPanelLocked) {
            startHideTimer();
        }
    }, [startHideTimer, isPanelLocked]);

    const handlePanelClick = useCallback(() => {
        setIsPanelLocked(true);
    }, []);

    const closePanel = useCallback(() => {
        setIsPanelLocked(false);
        setIsClosing(true);
        setTimeout(() => {
            setHoveredHash(null);
            setIsClosing(false);
        }, 200);
    }, []);

    const {
        commits,
        loading,
        hasMore,
        unpushedCommits,
        latestUnpushedHash,
        loadMore,
        setFilters
    } = useLogCommitLoader();




    const scrollToRow = useCallback((index: number) => {
        if (!containerRef.current) return;

        const centerOffset = clientHeight / 2 - ROW_HEIGHT / 2;
        containerRef.current.scrollTop = Math.max(0, index * ROW_HEIGHT - centerOffset);
    }, [clientHeight]);

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

    const handleRowClickWithHover = useCallback((e: React.MouseEvent, commit: Parameters<typeof handleRowClick>[1]) => {
        const clickedHash = commit.hash;
        if (hoveredHash && hoveredHash !== clickedHash) {
            setIsPanelLocked(false);
            setHoveredHash(null);
        }
        handleRowClick(e, commit);
        if (isNarrowMode) {
            startShowTimer(clickedHash);
        }
    }, [handleRowClick, isNarrowMode, startShowTimer, hoveredHash]);

    // Compute graph data
    const graph = useMemo(() => computeGraph(commits, hasMore), [commits, hasMore]);

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

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (commits.length === 0) return;

        let newIndex = -1;

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

        if (newIndex !== -1 && newIndex !== currentIndex) {
            const newHash = commits[newIndex].hash;
            setSelectedCommits([newHash]);
            onSelectionChange?.([newHash]);
            lastSelectedRef.current = newHash;

            // Ensure visible
            if (containerRef.current) {
                const rowTop = newIndex * ROW_HEIGHT;
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
    const totalHeight = commits.length * ROW_HEIGHT;
    const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER);
    const visibleCount = Math.ceil(clientHeight / ROW_HEIGHT) + 2 * BUFFER;
    const endIndex = Math.min(commits.length, startIndex + visibleCount);

    const visibleCommits = commits.slice(startIndex, endIndex);
    const offsetY = startIndex * ROW_HEIGHT;

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
                    <div style={{ height: totalHeight, position: 'relative' }}>
                        <div style={{
                            position: 'absolute',
                            top: offsetY,
                            left: 0,
                            right: 0,
                        }}>
                            {visibleCommits.map((commit, i) => {
                                const globalIndex = startIndex + i;
                                const graphNode = graph.get(commit.hash);
                                const selected = isSelected(commit.hash);
                                const isBlink = commit.hash === blinkHash;
                                const rowGraphWidth = graphNode ? (graphNode.maxX + 1) * CELL_WIDTH : CELL_WIDTH;
                                return (
                                    <div
                                        key={commit.hash}
                                        className={`${styles.row} ${!isBlink && selected ? styles.selected : ''} ${isBlink ? styles.blink : ''} ${focusedHash === commit.hash ? styles.focused : ''}`}
                                        onClick={(e) => {
                                            setFocusedHash(commit.hash);
                                            handleRowClickWithHover(e, commit);
                                        }}
                                        onMouseEnter={() => {
                                            setRowHoveredHash(commit.hash);
                                            handleRowMouseEnter(commit.hash, selected);
                                        }}
                                        onMouseLeave={() => {
                                            setRowHoveredHash(null);
                                            handleRowMouseLeave();
                                        }}
                                        onContextMenu={() => setFocusedHash(commit.hash)}
                                        data-vscode-context={JSON.stringify({
                                            webviewSection: 'gitLogCommit',
                                            hash: commit.hash,
                                            shortHash: commit.shortHash,
                                            subject: commit.subject,
                                            isUnpushed: unpushedCommits.has(commit.hash),
                                            isLatestUnpushed: commit.hash === latestUnpushedHash
                                        })}
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
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>

            {isNarrowMode && hoveredHash && externalSelectedHashes.includes(hoveredHash) && (
                <div
                    className={`${styles.sidePanel} ${isClosing ? styles.sidePanelClosing : ''}`}
                    onMouseEnter={handlePanelMouseEnter}
                    onMouseLeave={handlePanelMouseLeave}
                >
                    <CommitDetailsView
                        selectedHashes={externalSelectedHashes}
                        commit={commitDetails}
                        showBranches={true}
                        onFileInteraction={handlePanelClick}
                        onClose={closePanel}
                        isPinned={isPanelLocked}
                        onPin={handlePanelClick}
                    />
                </div>
            )}
        </div>
    );
};
