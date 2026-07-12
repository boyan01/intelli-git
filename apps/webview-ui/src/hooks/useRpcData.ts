import { useState, useCallback, useEffect, useRef, type SetStateAction } from 'react';
import { rpcEvents } from '../lib/rpc_client';
import { getStoredState, updateStoredState } from '../lib/stateCache';
import type { PersistedStateSchema } from './usePersistedState';
import { deserializePersistedValue, serializePersistedValue } from '../lib/persistedStateRegistry';
import type { RefreshScope } from '@shared/messages';

interface UseRpcDataOptions<T, K extends keyof PersistedStateSchema | undefined = undefined> {
    initialValue: T;
    refreshOnEvent?: boolean;
    cacheKey?: K;
    loadingOnRefresh?: boolean;
    enabled?: boolean;
    refreshScopes?: RefreshScope[];
    validateCachedValue?: (value: T) => boolean;
    maxCacheBytes?: number;
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
    const {
        initialValue,
        refreshOnEvent = true,
        cacheKey,
        loadingOnRefresh = false,
        enabled = true,
        refreshScopes,
        validateCachedValue,
        maxCacheBytes
    } = options;
    const hasLoadedRef = useRef(false);
    const mountedRef = useRef(false);
    const enabledRef = useRef(enabled);
    const fetcherRef = useRef(fetcher);
    const requestedSequenceRef = useRef(0);
    const inFlightRef = useRef<Promise<void> | null>(null);
    const pendingRef = useRef(false);
    const startedFetcherRef = useRef(fetcher);

    const [data, setData] = useState<T>(() => {
        if (cacheKey) {
            const stored = getStoredState()[cacheKey];
            if (stored === undefined || stored === null) {
                return initialValue;
            }
            const cachedValue = deserializePersistedValue(cacheKey, stored) as T;
            return validateCachedValue && !validateCachedValue(cachedValue) ? initialValue : cachedValue;
        }
        return initialValue;
    });
    const [loading, setLoading] = useState(enabled);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        enabledRef.current = enabled;
        fetcherRef.current = fetcher;
    }, [enabled, fetcher]);

    const persistValue = useCallback((value: T) => {
        if (cacheKey) {
            const serialized = serializePersistedValue(cacheKey, value as PersistedStateSchema[NonNullable<K>]);
            if (maxCacheBytes && JSON.stringify(serialized).length > maxCacheBytes) {
                updateStoredState(cacheKey, null);
                return;
            }
            updateStoredState(cacheKey, serialized);
        }
    }, [cacheKey, maxCacheBytes]);

    const updateData = useCallback((action: SetStateAction<T>) => {
        setData(previous => {
            const next = typeof action === 'function'
                ? (action as (value: T) => T)(previous)
                : action;
            persistValue(next);
            return next;
        });
    }, [persistValue]);

    const load = useCallback((queueTrailing = true): Promise<void> => {
        if (!enabledRef.current) {
            return Promise.resolve();
        }

        if (inFlightRef.current) {
            if (queueTrailing || startedFetcherRef.current !== fetcherRef.current) {
                requestedSequenceRef.current += 1;
                pendingRef.current = true;
            }
            return inFlightRef.current;
        }

        requestedSequenceRef.current += 1;
        startedFetcherRef.current = fetcherRef.current;
        const run = async () => {
            do {
                pendingRef.current = false;
                startedFetcherRef.current = fetcherRef.current;
                const requestSequence = requestedSequenceRef.current;
                try {
                    if (mountedRef.current && (loadingOnRefresh || !hasLoadedRef.current)) {
                        setLoading(true);
                    }
                    if (mountedRef.current) {
                        setError(null);
                    }
                    const result = await fetcherRef.current();
                    if (mountedRef.current && requestSequence === requestedSequenceRef.current) {
                        setData(result);
                        persistValue(result);
                    }
                } catch (e) {
                    if (mountedRef.current && requestSequence === requestedSequenceRef.current) {
                        setError(e instanceof Error ? e : new Error(String(e)));
                        console.error('Failed to load data:', e);
                    }
                } finally {
                    hasLoadedRef.current = true;
                    if (mountedRef.current && requestSequence === requestedSequenceRef.current) {
                        setLoading(false);
                    }
                }
            } while (pendingRef.current && enabledRef.current);
        };

        const request = run().finally(() => {
            inFlightRef.current = null;
            if (mountedRef.current && !pendingRef.current) {
                setLoading(false);
            }
        });
        inFlightRef.current = request;
        return request;
    }, [loadingOnRefresh, persistValue]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        if (!enabled) {
            requestedSequenceRef.current += 1;
            pendingRef.current = false;
            setLoading(false);
            return;
        }

        void load(false);
        if (refreshOnEvent) {
            return rpcEvents.refresh.subscribe(event => {
                if (!refreshScopes || event.scopes.some(scope => refreshScopes.includes(scope))) {
                    void load(true);
                }
            });
        }
    }, [enabled, fetcher, load, refreshOnEvent, refreshScopes]);

    const reload = useCallback(() => load(true), [load]);

    return { data, loading, error, reload, updateData };
}
