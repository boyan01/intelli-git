import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { LogCommit, LogOptions } from '@shared/messages';
import { rpc, rpcEvents } from '../../../lib/rpc_client';
import { LONG_DISTANCE_THRESHOLD } from '../graphUtils';
import { getStoredState, updateStoredState } from '../../../lib/stateCache';
import { deserializePersistedValue, serializePersistedValue } from '../../../lib/persistedStateRegistry';

interface UseLogCommitLoaderResult {
    commits: LogCommit[];
    loading: boolean;
    hasMore: boolean;
    unpushedCommits: Set<string>;
    latestUnpushedHash: string | null;
    loadMore: (reset?: boolean) => Promise<void>;
    setFilters: (filters: Partial<LogOptions>) => void;
}

const BATCH_SIZE = 50 + LONG_DISTANCE_THRESHOLD;

function arrayEquals<T>(left?: T[], right?: T[]): boolean {
    if (left === right) return true;
    if (!left || !right) return !left && !right;
    if (left.length !== right.length) return false;
    return left.every((value, index) => value === right[index]);
}

function filtersEqual(left: Partial<LogOptions>, right: Partial<LogOptions>): boolean {
    return left.branch === right.branch
        && left.search === right.search
        && left.regexMode === right.regexMode
        && left.caseSensitive === right.caseSensitive
        && arrayEquals(left.authors, right.authors)
        && arrayEquals(left.paths, right.paths)
        && left.since === right.since
        && left.until === right.until;
}

// Build initial filters from cached values to match FilterToolbar's initial state
function getInitialFilters(): Partial<LogOptions> {
    const state = getStoredState();
    const branch = deserializePersistedValue('gitLog.filter.branch', state['gitLog.filter.branch']);
    const search = deserializePersistedValue('gitLog.filter.search', state['gitLog.filter.search']);
    const regexMode = deserializePersistedValue('gitLog.filter.regexMode', state['gitLog.filter.regexMode']);
    const caseSensitive = deserializePersistedValue('gitLog.filter.caseSensitive', state['gitLog.filter.caseSensitive']);
    const authors = deserializePersistedValue('gitLog.filter.authors', state['gitLog.filter.authors']);
    const paths = deserializePersistedValue('gitLog.filter.paths', state['gitLog.filter.paths']);
    const since = deserializePersistedValue('gitLog.filter.since', state['gitLog.filter.since']);
    const until = deserializePersistedValue('gitLog.filter.until', state['gitLog.filter.until']);

    return {
        branch: branch === 'all' ? undefined : branch,
        search: search || undefined,
        regexMode: regexMode || undefined,
        caseSensitive: caseSensitive || undefined,
        authors: authors.length > 0 ? authors : undefined,
        paths: paths.length > 0 ? paths : undefined,
        since,
        until
    };
}

export const useLogCommitLoader = (): UseLogCommitLoaderResult => {
    const [commits, setCommits] = useState<LogCommit[]>(() =>
        deserializePersistedValue('gitLog.commits', getStoredState()['gitLog.commits'])
    );
    const [loading, setLoading] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [filters, setFilters] = useState<Partial<LogOptions>>(getInitialFilters);
    // Store as array to preserve order (first = latest unpushed)
    const [unpushedList, setUnpushedList] = useState<string[]>([]);
    const loadingRef = useRef(false);
    const commitsLengthRef = useRef(commits.length);
    const filtersRef = useRef(filters);
    const pendingResetRef = useRef(false);

    const unpushedCommits = useMemo(() => new Set(unpushedList), [unpushedList]);
    const latestUnpushedHash = unpushedList[0] ?? null;

    useEffect(() => {
        commitsLengthRef.current = commits.length;
    }, [commits.length]);

    useEffect(() => {
        filtersRef.current = filters;
    }, [filters]);

    const loadMore = useCallback(async (reset = false) => {
        if (loadingRef.current) {
            if (reset) {
                pendingResetRef.current = true;
            }
            return;
        }

        loadingRef.current = true;
        setLoading(true);
        try {
            let shouldReset = reset;

            do {
                pendingResetRef.current = false;
                const currentCount = shouldReset ? 0 : commitsLengthRef.current;
                const currentFilters = filtersRef.current;

                const [newCommits, newUnpushedList] = await Promise.all([
                    rpc.getLog({
                        maxCount: BATCH_SIZE,
                        skip: currentCount,
                        ...currentFilters
                    }),
                    shouldReset ? rpc.getUnpushedCommits() : Promise.resolve([])
                ]);

                if (shouldReset) {
                    setUnpushedList(newUnpushedList);
                }

                setHasMore(newCommits.length >= BATCH_SIZE);
                const isResetLoad = shouldReset;

                setCommits(prev => {
                    const result = isResetLoad ? newCommits : [...prev, ...newCommits];
                    updateStoredState('gitLog.commits', serializePersistedValue('gitLog.commits', result));
                    commitsLengthRef.current = result.length;
                    return result;
                });

                shouldReset = pendingResetRef.current;
            } while (shouldReset);
        } catch (error) {
            console.error('Failed to load logs', error);
        } finally {
            loadingRef.current = false;
            setLoading(false);
        }
    }, []);

    const updateFilters = useCallback((nextFilters: Partial<LogOptions>) => {
        setFilters(prev => filtersEqual(prev, nextFilters) ? prev : nextFilters);
    }, []);

    useEffect(() => {
        loadMore(true);
    }, [filters, loadMore]);

    // Subscribe to refresh events to reload commits when Git state changes
    useEffect(() => {
        return rpcEvents.refresh.subscribe(() => {
            loadMore(true);
        });
    }, [loadMore]);

    return {
        commits,
        loading,
        hasMore,
        unpushedCommits,
        latestUnpushedHash,
        loadMore,
        setFilters: updateFilters
    };
};
