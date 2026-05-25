import { useState, useEffect, useCallback, useRef } from 'react';
import { rpc, rpcEvents } from '@/lib/rpc_client';
import { useRpcEvent } from '@/hooks/useRpcEvent';
import type { CommitDetails } from '@shared/messages';

const PAGE_SIZE = 20;

function areCommitListsEqual(left: CommitDetails[], right: CommitDetails[]): boolean {
    if (left.length !== right.length) {
        return false;
    }

    return left.every((leftCommit, index) => {
        const rightCommit = right[index];
        if (!rightCommit) {
            return false;
        }

        if (
            leftCommit.hash !== rightCommit.hash ||
            leftCommit.subject !== rightCommit.subject ||
            leftCommit.body !== rightCommit.body ||
            leftCommit.authorName !== rightCommit.authorName ||
            leftCommit.authorEmail !== rightCommit.authorEmail ||
            leftCommit.date !== rightCommit.date ||
            leftCommit.files.length !== rightCommit.files.length
        ) {
            return false;
        }

        return leftCommit.files.every((leftFile, fileIndex) => {
            const rightFile = rightCommit.files[fileIndex];
            return Boolean(rightFile) &&
                leftFile.path === rightFile.path &&
                leftFile.displayPath === rightFile.displayPath &&
                leftFile.status === rightFile.status;
        });
    });
}

export function usePushData(selectedRemote: string, selectedRemoteBranch: string) {
    const [commits, setCommits] = useState<CommitDetails[]>([]);
    const [totalCommits, setTotalCommits] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const requestSeqRef = useRef(0);

    const loadCommits = useCallback(async (options: { reset?: boolean } = {}) => {
        if (!selectedRemote || !selectedRemoteBranch) {
            setCommits([]);
            setTotalCommits(0);
            setHasMore(false);
            return;
        }

        const requestSeq = requestSeqRef.current + 1;
        requestSeqRef.current = requestSeq;

        if (options.reset) {
            setCommits([]);
            setTotalCommits(0);
            setHasMore(false);
            setIsLoading(true);
        }

        try {
            const data = await rpc.getPushCommits({
                remote: selectedRemote,
                branch: selectedRemoteBranch,
                limit: PAGE_SIZE,
                skip: 0
            });

            if (requestSeqRef.current !== requestSeq) {
                return;
            }

            setCommits(prev => areCommitListsEqual(prev, data.commits) ? prev : data.commits);
            setHasMore(prev => prev === data.hasMore ? prev : data.hasMore);
            setTotalCommits(prev => prev === data.totalCount ? prev : data.totalCount);
        } catch (error) {
            console.error('Failed to load push commits:', error);
        } finally {
            if (requestSeqRef.current === requestSeq) {
                setIsLoading(false);
            }
        }
    }, [selectedRemote, selectedRemoteBranch]);

    // Load commits when branch selection changes
    useEffect(() => {
        loadCommits({ reset: true });
    }, [loadCommits]);

    // Refresh without unmounting the visible list; otherwise expanded commits flicker.
    useRpcEvent(rpcEvents.refresh, () => {
        loadCommits();
    });

    const handleLoadMore = useCallback(async () => {
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
    }, [commits.length, isLoadingMore, selectedRemote, selectedRemoteBranch]);

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
