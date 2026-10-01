import type { BranchInfo } from '@shared/messages';

export interface LocalChangesPersistedStateSchema {
    'commit.activeTab': 'commit' | 'stash' | 'push';
    'commit.activeTabTimestamp': number;
    'commit.branchInfo': BranchInfo;
}

export const localChangesStateDefaults: LocalChangesPersistedStateSchema = {
    'commit.activeTab': 'commit',
    'commit.activeTabTimestamp': 0,
    'commit.branchInfo': { current: '', all: [], ahead: 0, behind: 0, rebaseStatus: 'none' },
};
