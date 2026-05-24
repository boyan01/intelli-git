import type { PushInitState } from '@shared/messages';
import type { SavedPushBranchSelection } from './pushTarget';

export interface PushPersistedStateSchema {
    'push.branchSelection': SavedPushBranchSelection;
    'push.initState': PushInitState;
    'push.remoteBranches': {
        remote: string;
        branches: string[];
    };
}

export const pushStateDefaults: PushPersistedStateSchema = {
    'push.branchSelection': {
        repositoryPath: '',
        localBranch: '',
        remote: '',
        remoteBranch: '',
        confirmed: false
    },
    'push.initState': {
        repositoryPath: '',
        localBranch: '',
        remotes: []
    },
    'push.remoteBranches': {
        remote: '',
        branches: []
    }
};
