import { useState, useEffect, useCallback } from 'react';
import { rpc, rpcEvents } from '@/lib/rpc_client';
import { useRpcEvent } from '@/hooks/useRpcEvent';
import type { CommitDetails } from '@shared/messages';

const PAGE_SIZE = 20;

export function usePushData(selectedRemote: string, selectedRemoteBranch: string) {
    const [commits, setCommits] = useState<CommitDetails[]>([]);
    const [totalCommits, setTotalCommits] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);

    const loadCommits = useCallback(async () => {
        if (!selectedRemote || !selectedRemoteBranch) {
            setCommits([]);
            setTotalCommits(0);
            setHasMore(false);
            return;
        }
        setIsLoading(true);
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
        } finally {
            setIsLoading(false);
        }
    }, [selectedRemote, selectedRemoteBranch]);

    // Load commits when branch selection changes
    useEffect(() => {
        loadCommits();
    }, [loadCommits]);

    // Refresh when repo changes
    useRpcEvent(rpcEvents.refresh, () => {
        loadCommits();
    });

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
            setTotalCommits(data.totalCount);
        } catch (error) {
            console.error('Failed to load more commits:', error);
        } finally {
            setIsLoadingMore(false);
        }
    };

    return {
        commits,
        totalCommits,
        hasMore,
        isLoading,
        isLoadingMore,
        reload: loadCommits,
        handleLoadMore,
    };
}
