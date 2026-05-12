import { commitStateDefaults, type CommitPersistedStateSchema } from '../components/commit/persistedState';
import { gitLogStateDefaults, type GitLogPersistedStateSchema } from '../components/git-log/persistedState';
import { localChangesStateDefaults, type LocalChangesPersistedStateSchema } from '../components/local-changes/persistedState';
import { pushStateDefaults, type PushPersistedStateSchema } from '../components/push/persistedState';
import { stashStateDefaults, type StashPersistedStateSchema } from '../components/stash/persistedState';

export type PersistedStateSchema =
    CommitPersistedStateSchema
    & LocalChangesPersistedStateSchema
    & PushPersistedStateSchema
    & StashPersistedStateSchema
    & GitLogPersistedStateSchema;

export const stateDefaults: PersistedStateSchema = {
    ...commitStateDefaults,
    ...localChangesStateDefaults,
    ...pushStateDefaults,
    ...stashStateDefaults,
    ...gitLogStateDefaults
};

export const persistedKeys = Object.keys(stateDefaults) as Array<keyof PersistedStateSchema>;

export const legacyPersistedKeys = [
    'commit.selectedFiles',
    'commit.files',
    'push.splitSize',
    'push.details.viewMode',
    'push.details.showDetails',
    'push.details.splitSize',
    'stash.splitSize',
    'branchList.expandedGroups',
    'branchList.selectedBranch'
] as const;

export function serializePersistedValue<K extends keyof PersistedStateSchema>(
    _key: K,
    value: PersistedStateSchema[K]
): unknown {
    if (value instanceof Set) {
        return Array.from(value);
    }
    return value;
}

export function deserializePersistedValue<K extends keyof PersistedStateSchema>(
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
