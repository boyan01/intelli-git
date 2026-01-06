// Re-export shared types
export type {
    FileStatus,
    ChangelistGroup,
    BranchInfo,
    CommitDetails,
    CommitFile,
    PushConfig,
    StashItem,
} from '@shared/messages';

// Local types for backward compatibility
export interface Changelist {
    id: string;
    name: string;
    description?: string;
    isDefault: boolean;
    files: string[];
}

export interface PushState {
    commits: import('@shared/messages').CommitDetails[];
    files: import('@shared/messages').CommitFile[];
    config: import('@shared/messages').PushConfig;
}
