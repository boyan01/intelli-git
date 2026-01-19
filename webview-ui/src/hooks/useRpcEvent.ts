import { useState, useEffect, useRef, type DependencyList } from 'react';
import type { EventStream } from '@/lib/rpc_client';

/**
 * Hook to subscribe to an RPC event stream.
 * Can be used in two modes:
 * 1. Data binding: Pass an initial value to get the current event data state.
 * 2. Side effect: Pass a handler function to execute logic on event.
 */

// Mode 1: Data binding
export function useRpcEvent<T>(eventStream: EventStream<T>, initialValue: T): T;
export function useRpcEvent<T>(eventStream: EventStream<T>, initialValue: null): T | null;

// Mode 2: Side effect
export function useRpcEvent<T>(
    eventStream: EventStream<T>,
    handler: (data: T) => void,
    deps?: DependencyList
): void;

// Implementation
export function useRpcEvent<T>(
    eventStream: EventStream<T>,
    arg2: T | ((data: T) => void) | null,
    arg3: DependencyList = []
): T | null | void {
    // If arg2 is a function, we assume it's a handler (Side effect mode)
    // Note: This assumes T is not a function type, which is true for RPC data.
    const isHandler = typeof arg2 === 'function';

    // State for data binding mode
    const [state, setState] = useState<T | null>(!isHandler ? (arg2 as T | null) : null);

    // Ref for handler (Side effect mode)
    const handlerRef = useRef<(data: T) => void>(isHandler ? (arg2 as (data: T) => void) : () => { });

    useEffect(() => {
        if (isHandler) {
            handlerRef.current = arg2 as (data: T) => void;
        }
    }, [arg2, isHandler]);

    useEffect(() => {
        const unsub = eventStream.subscribe((data) => {
            if (isHandler) {
                handlerRef.current(data);
            } else {
                setState(data);
            }
        });
        return unsub;
    }, [eventStream, isHandler, ...(isHandler ? arg3 : [])]);

    if (!isHandler) {
        return state;
    }
}
