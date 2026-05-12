import type { PushInitState } from '@shared/messages';

export interface PushPersistedStateSchema {
    'push.branchSelection': {
        localBranch: string;
        remote: string;
        remoteBranch: string;
    };
    'push.initState': PushInitState;
    'push.remoteBranches': {
        remote: string;
        branches: string[];
    };
}

export const pushStateDefaults: PushPersistedStateSchema = {
    'push.branchSelection': {
        localBranch: '',
        remote: '',
        remoteBranch: ''
    },
    'push.initState': {
        localBranch: '',
        remotes: []
    },
    'push.remoteBranches': {
        remote: '',
        branches: []
    }
};
