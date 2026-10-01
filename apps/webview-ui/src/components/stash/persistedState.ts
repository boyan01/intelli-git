export interface StashPersistedStateSchema {
    'stash.viewMode': 'tree' | 'list';
    'stash.selectedIndex': number | null;
}

export const stashStateDefaults: StashPersistedStateSchema = {
    'stash.viewMode': 'tree',
    'stash.selectedIndex': null,
};
