import type { CommitViewState } from '@shared/messages';

export interface CommitPersistedStateSchema {
    'commit.viewMode': 'tree' | 'list';
    'commit.message': string;
    'commit.amend': boolean;
    'commit.expandedIds': Set<string>;
    'commit.viewState': CommitViewState;
}

export const commitStateDefaults: CommitPersistedStateSchema = {
    'commit.viewMode': 'tree',
    'commit.message': '',
    'commit.amend': false,
    'commit.expandedIds': new Set(),
    'commit.viewState': {
        files: [],
        changelistState: {
            mode: 'staged',
            activeListId: 'changes',
            lists: [{ id: 'changes', name: 'Changes', isDefault: true, isActive: true }],
            assignments: {}
        },
        workspaceRoot: '',
        repositories: []
    }
};
