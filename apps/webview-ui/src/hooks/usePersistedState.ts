import { useState, useCallback } from 'react';
import { getStoredState, updateStoredState } from '../lib/stateCache';
import type { FileStatus, BranchInfo, BranchListData, LogCommit, CommitViewState } from '@shared/messages';

/**
 * Schema defining all persistable state keys and their types.
 * Add new keys here to enable type-safe persistence.
 */
export interface PersistedStateSchema {
    // Commit View
    'commit.viewMode': 'tree' | 'list';
    'commit.activeTab': 'commit' | 'stash' | 'push';
    'commit.activeTabTimestamp': number;
    'commit.message': string;
    'commit.amend': boolean;
    'commit.selectedFiles': Set<string>;
    'commit.expandedIds': Set<string>;
    'commit.files': FileStatus[];
    'commit.viewState': CommitViewState;
    'commit.branchInfo': BranchInfo;

    // Push View
    'push.splitSize': number;
    'push.branchSelection': {
        localBranch: string;
        remote: string;
        remoteBranch: string;
    };

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
    'branchList.scrollTop': number;

    // Git Log View
    'gitLog.branchListData': BranchListData;
    'gitLog.filter.branch': string;
    'gitLog.filter.search': string;
    'gitLog.filter.regexMode': boolean;
    'gitLog.filter.caseSensitive': boolean;
    'gitLog.filter.authors': string[];
    'gitLog.filter.paths': string[];
    'gitLog.filter.since': string | undefined;
    'gitLog.filter.until': string | undefined;
    'gitLog.commits': LogCommit[];
    'gitLog.scrollTop': number;
    'gitLog.selectedHashes': string[];
    'gitLog.branchSplitRatio': number;
    'gitLog.detailsSplitRatio': number;
}

export const stateDefaults: PersistedStateSchema = {
    // Commit View
    'commit.viewMode': 'tree',
    'commit.activeTab': 'commit',
    'commit.activeTabTimestamp': 0,
    'commit.message': '',
    'commit.amend': false,
    'commit.selectedFiles': new Set(),
    'commit.expandedIds': new Set(),
    'commit.files': [],
    'commit.viewState': {
        files: [],
        changelistState: {
            mode: 'staged',
            activeListId: 'changes',
            lists: [{ id: 'changes', name: 'Changes', isDefault: true, isActive: true }],
            assignments: {}
        },
        workspaceRoot: ''
    },
    'commit.branchInfo': { current: '', all: [], ahead: 0, behind: 0, rebaseStatus: 'none' },

    // Push View
    'push.splitSize': 300,
    'push.branchSelection': {
        localBranch: '',
        remote: '',
        remoteBranch: ''
    },

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
    'branchList.scrollTop': 0,

    // Git Log View
    'gitLog.branchListData': {
        currentBranch: '',
        localBranches: [],
        localBranchesInfo: [],
        remoteBranches: {},
        tags: []
    },
    'gitLog.filter.branch': 'all',
    'gitLog.filter.search': '',
    'gitLog.filter.regexMode': false,
    'gitLog.filter.caseSensitive': false,
    'gitLog.filter.authors': [],
    'gitLog.filter.paths': [],
    'gitLog.filter.since': undefined,
    'gitLog.filter.until': undefined,
    'gitLog.commits': [],
    'gitLog.scrollTop': 0,
    'gitLog.selectedHashes': [],
    'gitLog.branchSplitRatio': 0,
    'gitLog.detailsSplitRatio': 0.68,
};

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
