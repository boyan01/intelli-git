import { useState, useCallback, useEffect, useRef } from 'react';
import { rpcEvents } from '../lib/rpc_client';

interface UseRpcDataOptions<T> {
    initialValue: T;
    refreshOnEvent?: boolean;
}

/**
 * Generic hook for loading data via RPC with automatic refresh on rpcEvents.refresh.
 *
 * @param fetcher - Async function that fetches the data
 * @param options - Configuration options
 * @returns { data, loading, error, reload }
 *
 * @example
 * const { data: branches } = useRpcData(() => rpc.getBranchInfo(), {
 *     initialValue: { current: '', all: [] }
 * });
 */
export function useRpcData<T>(
    fetcher: () => Promise<T>,
    options: UseRpcDataOptions<T>
) {
    const { initialValue, refreshOnEvent = true } = options;
    const fetcherRef = useRef(fetcher);
    fetcherRef.current = fetcher;

    const [data, setData] = useState<T>(initialValue);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    const load = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const result = await fetcherRef.current();
            setData(result);
        } catch (e) {
            setError(e instanceof Error ? e : new Error(String(e)));
            console.error('Failed to load data:', e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
        if (refreshOnEvent) {
            return rpcEvents.refresh.subscribe(load);
        }
    }, [load, refreshOnEvent]);

    return { data, loading, error, reload: load };
}
