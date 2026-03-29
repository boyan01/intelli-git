import { useState, useCallback, useEffect } from 'react';
import { rpcEvents } from '../lib/rpc_client';
import { getCachedValue, updateStoredState } from '../lib/stateCache';
import type { PersistedStateSchema } from './usePersistedState';

interface UseRpcDataOptions<T, K extends keyof PersistedStateSchema | undefined = undefined> {
    initialValue: T;
    refreshOnEvent?: boolean;
    cacheKey?: K;
}

/**
 * Generic hook for loading data via RPC with automatic refresh on rpcEvents.refresh.
 * Supports optional caching to vscode state for instant display on reopen.
 *
 * @example
 * const { data: files } = useRpcData(() => rpc.getStatus(), {
 *     initialValue: [] as FileStatus[],
 *     cacheKey: 'commit.files'
 * });
 */
export function useRpcData<T, K extends keyof PersistedStateSchema | undefined = undefined>(
    fetcher: () => Promise<T>,
    options: UseRpcDataOptions<T, K>
) {
    const { initialValue, refreshOnEvent = true, cacheKey } = options;

    const [data, setData] = useState<T>(() => {
        if (cacheKey) {
            return getCachedValue(cacheKey, initialValue);
        }
        return initialValue;
    });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    const load = useCallback(async () => {
        try {
            setError(null);
            const result = await fetcher();
            setData(result);
            if (cacheKey) {
                updateStoredState(cacheKey, result);
            }
        } catch (e) {
            setError(e instanceof Error ? e : new Error(String(e)));
            console.error('Failed to load data:', e);
        } finally {
            setLoading(false);
        }
    }, [cacheKey, fetcher]);

    useEffect(() => {
        load();
        if (refreshOnEvent) {
            return rpcEvents.refresh.subscribe(load);
        }
    }, [load, refreshOnEvent]);

    return { data, loading, error, reload: load };
}
