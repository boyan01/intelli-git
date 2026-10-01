import { useState, useCallback } from 'react';
import { getStoredState, updateStoredState } from '../lib/stateCache';
import {
    deserializePersistedValue,
    serializePersistedValue,
    type PersistedStateSchema,
} from '../lib/persistedStateRegistry';

export type { PersistedStateSchema } from '../lib/persistedStateRegistry';

export function usePersistedState<K extends keyof PersistedStateSchema>(
    key: K
): [
    PersistedStateSchema[K],
    (value: PersistedStateSchema[K] | ((prev: PersistedStateSchema[K]) => PersistedStateSchema[K])) => void,
] {
    const [value, setValue] = useState<PersistedStateSchema[K]>(() => {
        const stored = getStoredState()[key];
        return deserializePersistedValue(key, stored);
    });

    const setValueAndPersist = useCallback(
        (newValue: PersistedStateSchema[K] | ((prev: PersistedStateSchema[K]) => PersistedStateSchema[K])) => {
            setValue((prev) => {
                const resolved =
                    typeof newValue === 'function'
                        ? (newValue as (prev: PersistedStateSchema[K]) => PersistedStateSchema[K])(prev)
                        : newValue;
                updateStoredState(key, serializePersistedValue(key, resolved));
                return resolved;
            });
        },
        [key]
    );

    return [value, setValueAndPersist];
}
