import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import styles from './LogListPanel.module.css';

import { computeGraph, LONG_DISTANCE_THRESHOLD } from './graphUtils';
import { GraphColumn, CELL_WIDTH } from './GraphColumn';
import { FilterToolbar } from './filter-toolbar/FilterToolbar';
import { RefLabel } from './RefLabel';
import { useLogCommitLoader } from './hooks/useLogCommitLoader';
import { useCommitSelection } from './hooks/useCommitSelection';

interface LogListPanelProps {
    onSelectionChange?: (commits: string[]) => void;
}

const ROW_HEIGHT = 24;
const BUFFER = 10;

export const LogListPanel: React.FC<LogListPanelProps> = ({ onSelectionChange }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [clientHeight, setClientHeight] = useState(0);

    const {
        commits,
        loading,
        hasMore,
        loadMore,
        setFilters
    } = useLogCommitLoader();

    const scrollToRow = useCallback((index: number) => {
        if (!containerRef.current) return;

        const centerOffset = clientHeight / 2 - ROW_HEIGHT / 2;
        containerRef.current.scrollTop = Math.max(0, index * ROW_HEIGHT - centerOffset);
    }, [clientHeight]);

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
        scrollToRow
    });

    // Compute graph data
    const graph = useMemo(() => computeGraph(commits), [commits]);

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

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const target = e.currentTarget;
        setScrollTop(target.scrollTop);

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
            <FilterToolbar onFilterChange={setFilters} />

            <div
                ref={containerRef}
                className={styles.list}
                onScroll={handleScroll}
                tabIndex={0}
                onKeyDown={handleKeyDown}
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
                                    className={`${styles.row} ${!isBlink && selected ? styles.selected : ''} ${isBlink ? styles.blink : ''}`}
                                    onClick={(e) => handleRowClick(e, commit)}
                                    data-vscode-context={JSON.stringify({
                                        webviewSection: 'gitLogCommit',
                                        hash: commit.hash,
                                        shortHash: commit.shortHash,
                                        subject: commit.subject
                                    })}
                                >
                                    <div className={styles.graphCol} style={{ width: rowGraphWidth }}>
                                        {graphNode && <GraphColumn node={graphNode} rowHeight={ROW_HEIGHT} graphWidth={rowGraphWidth} rowIndex={globalIndex} onJumpToCommit={handleJumpToCommit} />}
                                    </div>
                                    <div className={styles.subject}>
                                        {commit.refs && commit.refs.map((ref, i) => (
                                            <RefLabel key={i} name={ref.name} type={ref.type} />
                                        ))}
                                        {commit.subject}
                                    </div>
                                    <span className={styles.author}>{commit.authorName}</span>
                                    <span className={styles.date}>
                                        {new Date(commit.date).toLocaleDateString()}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};
