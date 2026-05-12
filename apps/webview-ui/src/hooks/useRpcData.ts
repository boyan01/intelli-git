import { useState, useCallback, useEffect } from 'react';
import { rpcEvents } from '../lib/rpc_client';
import { getStoredState, updateStoredState } from '../lib/stateCache';
import type { PersistedStateSchema } from './usePersistedState';
import { deserializePersistedValue, serializePersistedValue } from '../lib/persistedStateRegistry';

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
 * const { data: viewState } = useRpcData(() => rpc.getCommitViewState(), {
 *     initialValue: initialCommitViewState,
 *     cacheKey: 'commit.viewState'
 * });
 */
export function useRpcData<T, K extends keyof PersistedStateSchema | undefined = undefined>(
    fetcher: () => Promise<T>,
    options: UseRpcDataOptions<T, K>
) {
    const { initialValue, refreshOnEvent = true, cacheKey } = options;

    const [data, setData] = useState<T>(() => {
        if (cacheKey) {
            const stored = getStoredState()[cacheKey];
            if (stored === undefined || stored === null) {
                return initialValue;
            }
            return deserializePersistedValue(cacheKey, stored) as T;
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
                updateStoredState(cacheKey, serializePersistedValue(cacheKey, result as PersistedStateSchema[NonNullable<K>]));
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
