import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import styles from './LogListPanel.module.css';
import type { LogCommit, LogOptions } from '../../../../shared/messages';
import { rpc } from '../../lib/rpc_client';
import { computeGraph, LONG_DISTANCE_THRESHOLD } from './graphUtils';
import { GraphColumn, CELL_WIDTH } from './GraphColumn';
import { FilterToolbar } from './FilterToolbar';
import { RefLabel } from './RefLabel';

interface LogListPanelProps {
    onSelectionChange?: (commits: string[]) => void;
}

export const LogListPanel: React.FC<LogListPanelProps> = ({ onSelectionChange }) => {
    const [commits, setCommits] = useState<LogCommit[]>([]);
    const [loading, setLoading] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [scrollTop, setScrollTop] = useState(0);
    const [clientHeight, setClientHeight] = useState(0);
    const [filters, setFilters] = useState<Partial<LogOptions>>({});
    const containerRef = useRef<HTMLDivElement>(null);

    const [selectedCommits, setSelectedCommits] = useState<string[]>([]);
    const [blinkHash, setBlinkHash] = useState<string | null>(null);
    const lastSelectedRef = useRef<string | null>(null);

    const ROW_HEIGHT = 24;
    const BUFFER = 10;
    // Load extra commits to ensure long-distance targets (30 rows) are visible
    const BATCH_SIZE = 50 + LONG_DISTANCE_THRESHOLD;

    const handleRowClick = (e: React.MouseEvent, commit: LogCommit) => {
        const hash = commit.hash;
        let newSelection: string[] = [];

        if (e.metaKey || e.ctrlKey) {
            // Toggle selection
            if (selectedCommits.includes(hash)) {
                newSelection = selectedCommits.filter(h => h !== hash);
            } else {
                newSelection = [...selectedCommits, hash];
            }
            lastSelectedRef.current = hash;
        } else if (e.shiftKey && lastSelectedRef.current) {
            // Range selection
            const lastIndex = commits.findIndex(c => c.hash === lastSelectedRef.current);
            const currentIndex = commits.findIndex(c => c.hash === hash);
            if (lastIndex !== -1 && currentIndex !== -1) {
                const start = Math.min(lastIndex, currentIndex);
                const end = Math.max(lastIndex, currentIndex);
                const range = commits.slice(start, end + 1).map(c => c.hash);
                // Combine with existing selection if using modifier? Usually Shift replaces or extends.
                // Standard behavior: Shift+Click extends from anchor.
                // For simplicity: Replace selection with new range, or union?
                // VS Code / OS usually extends anchor.
                // Let's just select the range.
                newSelection = range;
            } else {
                newSelection = [hash];
                lastSelectedRef.current = hash;
            }
        } else {
            // Single selection
            newSelection = [hash];
            lastSelectedRef.current = hash;
        }

        setSelectedCommits(newSelection);
        onSelectionChange?.(newSelection);
    };

    const isSelected = (hash: string) => selectedCommits.includes(hash);

    // Compute graph data
    const graph = useMemo(() => computeGraph(commits), [commits]);

    const handleJumpToCommit = useCallback((hash: string) => {
        const index = commits.findIndex(c => c.hash === hash);
        if (index !== -1 && containerRef.current) {
            // Center the target commit in viewport
            const centerOffset = clientHeight / 2 - ROW_HEIGHT / 2;
            containerRef.current.scrollTop = Math.max(0, index * ROW_HEIGHT - centerOffset);
            setSelectedCommits([hash]);
            onSelectionChange?.([hash]);
            lastSelectedRef.current = hash;

            // Blink effect
            setBlinkHash(hash);
            setTimeout(() => setBlinkHash(null), 1000);
        }
    }, [commits, onSelectionChange, clientHeight]);

    const loadMore = useCallback(async (reset = false) => {
        if (loading && !reset) return;
        setLoading(true);
        try {
            const currentCount = reset ? 0 : commits.length;
            const newCommits = await rpc.getLog({
                maxCount: BATCH_SIZE,
                skip: currentCount,
                ...filters
            });

            if (newCommits.length < BATCH_SIZE) {
                setHasMore(false);
            }

            setCommits(prev => reset ? newCommits : [...prev, ...newCommits]);
        } catch (error) {
            console.error('Failed to load logs', error);
        } finally {
            setLoading(false);
        }
    }, [commits.length, loading, filters]);

    // Reload when filters change
    useEffect(() => {
        setCommits([]);
        setHasMore(true);
        setScrollTop(0);
        if (containerRef.current) containerRef.current.scrollTop = 0;
        loadMore(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filters]);

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

        let newHash: string | null = null;
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
            newHash = commits[newIndex].hash;
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
                style={{ outline: 'none' }} // Remove focus outline for cleaner look, or style it
            >
                <div style={{ height: totalHeight, position: 'relative' }}>
                    <div style={{
                        position: 'absolute',
                        top: offsetY,
                        left: 0,
                        right: 0,
                    }}>
                        {visibleCommits.map((commit) => {
                            const graphNode = graph.get(commit.hash);
                            const selected = isSelected(commit.hash);
                            const isBlink = commit.hash === blinkHash;
                            const rowGraphWidth = graphNode ? (graphNode.maxX + 2) * CELL_WIDTH : CELL_WIDTH * 2;
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
                                        {graphNode && <GraphColumn node={graphNode} rowHeight={ROW_HEIGHT} graphWidth={rowGraphWidth} onJumpToCommit={handleJumpToCommit} />}
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
                {loading && (
                    <div style={{ padding: 8, textAlign: 'center', position: 'absolute', bottom: 0, width: '100%' }}>Loading...</div>
                )}
            </div>
        </div>
    );
};
