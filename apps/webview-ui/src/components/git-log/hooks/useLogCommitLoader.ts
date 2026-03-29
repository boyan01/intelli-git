import { useState, useCallback, useEffect, useMemo } from 'react';
import type { LogCommit, LogOptions } from '@shared/messages';
import { rpc, rpcEvents } from '../../../lib/rpc_client';
import { LONG_DISTANCE_THRESHOLD } from '../graphUtils';
import { getCachedValue, updateStoredState } from '../../../lib/stateCache';

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

// Build initial filters from cached values to match FilterToolbar's initial state
function getInitialFilters(): Partial<LogOptions> {
    const branch = getCachedValue('gitLog.filter.branch', 'all');
    const search = getCachedValue('gitLog.filter.search', '');
    const regexMode = getCachedValue('gitLog.filter.regexMode', false);
    const caseSensitive = getCachedValue('gitLog.filter.caseSensitive', false);
    const authors = getCachedValue('gitLog.filter.authors', [] as string[]);
    const paths = getCachedValue('gitLog.filter.paths', [] as string[]);
    const since = getCachedValue('gitLog.filter.since', undefined as string | undefined);
    const until = getCachedValue('gitLog.filter.until', undefined as string | undefined);

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
        getCachedValue('gitLog.commits', [])
    );
    const [loading, setLoading] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [filters, setFilters] = useState<Partial<LogOptions>>(getInitialFilters);
    // Store as array to preserve order (first = latest unpushed)
    const [unpushedList, setUnpushedList] = useState<string[]>([]);

    const unpushedCommits = useMemo(() => new Set(unpushedList), [unpushedList]);
    const latestUnpushedHash = unpushedList[0] ?? null;

    const loadMore = useCallback(async (reset = false) => {
        if (!reset && loading) return;

        setLoading(true);
        try {
            const currentCount = reset ? 0 : commits.length;

            const [newCommits, newUnpushedList] = await Promise.all([
                rpc.getLog({
                    maxCount: BATCH_SIZE,
                    skip: currentCount,
                    ...filters
                }),
                reset ? rpc.getUnpushedCommits() : Promise.resolve([])
            ]);

            if (reset) {
                setUnpushedList(newUnpushedList);
            }

            if (newCommits.length < BATCH_SIZE) {
                setHasMore(false);
            } else {
                setHasMore(true);
            }

            setCommits(prev => {
                const result = reset ? newCommits : [...prev, ...newCommits];
                updateStoredState('gitLog.commits', result);
                return result;
            });
        } catch (error) {
            console.error('Failed to load logs', error);
        } finally {
            setLoading(false);
        }
    }, [commits.length, loading, filters]);

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
        setFilters
    };
};
