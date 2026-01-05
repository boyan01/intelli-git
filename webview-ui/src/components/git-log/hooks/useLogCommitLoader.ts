import { useState, useCallback, useEffect } from 'react';
import type { LogCommit, LogOptions } from '../../../../../shared/messages';
import { rpc } from '../../../lib/rpc_client';
import { LONG_DISTANCE_THRESHOLD } from '../graphUtils';

interface UseLogCommitLoaderResult {
    commits: LogCommit[];
    loading: boolean;
    hasMore: boolean;
    loadMore: (reset?: boolean) => Promise<void>;
    setFilters: (filters: Partial<LogOptions>) => void;
}

const BATCH_SIZE = 50 + LONG_DISTANCE_THRESHOLD;

export const useLogCommitLoader = (): UseLogCommitLoaderResult => {
    const [commits, setCommits] = useState<LogCommit[]>([]);
    const [loading, setLoading] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [filters, setFilters] = useState<Partial<LogOptions>>({});

    const loadMore = useCallback(async (reset = false) => {
        if (!reset && loading) return;

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
            } else {
                setHasMore(true);
            }

            setCommits(prev => reset ? newCommits : [...prev, ...newCommits]);
        } catch (error) {
            console.error('Failed to load logs', error);
        } finally {
            setLoading(false);
        }
    }, [commits.length, loading, filters]);

    useEffect(() => {
        loadMore(true);
    }, [filters]);

    return {
        commits,
        loading,
        hasMore,
        loadMore,
        setFilters
    };
};
