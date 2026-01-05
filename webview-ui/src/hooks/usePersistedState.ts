import { useState, useCallback } from 'react';
import { vscode } from '../lib/vscode';

/**
 * Schema defining all persistable state keys and their types.
 * Add new keys here to enable type-safe persistence.
 */
export interface PersistedStateSchema {
    // Commit View
    'commit.viewMode': 'tree' | 'list';
    'commit.activeTab': 'commit' | 'stash';
    'commit.message': string;
    'commit.amend': boolean;
    'commit.selectedFiles': Set<string>;
    'commit.collapsedGroups': Set<string>;

    // Push View
    'push.splitSize': number;

    // Push Commit Details
    'push.details.viewMode': 'tree' | 'list';
    'push.details.showDetails': boolean;
    'push.details.splitSize': number;

    // Stash View
    'stash.viewMode': 'tree' | 'list';
    'stash.splitSize': number;
    'stash.selectedIndex': number | null;

    // Branch List Panel
    'branchList.expandedGroups': Set<string>;
    'branchList.expandedIds': Set<string>;
    'branchList.selectedBranch': string | null;
    'branchList.selectedId': string | null;
    'branchList.filterText': string;
}

export const stateDefaults: PersistedStateSchema = {
    // Commit View
    'commit.viewMode': 'tree',
    'commit.activeTab': 'commit',
    'commit.message': '',
    'commit.amend': false,
    'commit.selectedFiles': new Set(),
    'commit.collapsedGroups': new Set(),

    // Push View
    'push.splitSize': 300,

    // Push Commit Details
    'push.details.viewMode': 'tree',
    'push.details.showDetails': true,
    'push.details.splitSize': 150,

    // Stash View
    'stash.viewMode': 'tree',
    'stash.splitSize': 150,
    'stash.selectedIndex': null,

    // Branch List Panel
    'branchList.expandedGroups': new Set(['local']), // Default expand local branches
    'branchList.expandedIds': new Set(['local']),
    'branchList.selectedBranch': null,
    'branchList.selectedId': null,
    'branchList.filterText': '',
};

type StoredState = Record<string, unknown>;

let stateCache: StoredState | null = null;

function getStoredState(): StoredState {
    if (stateCache === null) {
        stateCache = vscode.getState<StoredState>() ?? {};
    }
    return stateCache;
}

function updateStoredState(key: string, value: unknown): void {
    const state = getStoredState();
    state[key] = value;
    stateCache = state;
    vscode.setState(state);
}

function serialize<K extends keyof PersistedStateSchema>(
    _key: K,
    value: PersistedStateSchema[K]
): unknown {
    if (value instanceof Set) {
        return Array.from(value);
    }
    return value;
}

function deserialize<K extends keyof PersistedStateSchema>(
    key: K,
    stored: unknown
): PersistedStateSchema[K] {
    const defaultValue = stateDefaults[key];

    if (stored === undefined || stored === null) {
        return defaultValue;
    }

    if (defaultValue instanceof Set) {
        if (Array.isArray(stored)) {
            return new Set(stored) as PersistedStateSchema[K];
        }
        return defaultValue;
    }

    return stored as PersistedStateSchema[K];
}

/**
 * A type-safe useState hook that automatically persists to vscode state.
 *
 * @param key - A predefined key from PersistedStateSchema
 * @param defaultValue - Optional override for the default value
 * @returns A tuple of [value, setValue] similar to useState
 *
 * @example
 * const [viewMode, setViewMode] = usePersistedState('push.details.viewMode');
 * // viewMode is typed as 'tree' | 'list'
 */
export function usePersistedState<K extends keyof PersistedStateSchema>(
    key: K
): [PersistedStateSchema[K], (value: PersistedStateSchema[K] | ((prev: PersistedStateSchema[K]) => PersistedStateSchema[K])) => void] {
    const [value, setValue] = useState<PersistedStateSchema[K]>(() => {
        const stored = getStoredState()[key];
        return deserialize(key, stored);
    });

    const setValueAndPersist = useCallback(
        (newValue: PersistedStateSchema[K] | ((prev: PersistedStateSchema[K]) => PersistedStateSchema[K])) => {
            setValue((prev) => {
                const resolved = typeof newValue === 'function'
                    ? (newValue as (prev: PersistedStateSchema[K]) => PersistedStateSchema[K])(prev)
                    : newValue;
                updateStoredState(key, serialize(key, resolved));
                return resolved;
            });
        },
        [key]
    );

    return [value, setValueAndPersist];
}
