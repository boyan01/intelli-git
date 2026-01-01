// Re-export shared types
export type {
    FileStatus,
    ChangelistGroup,
    BranchInfo,
    CommitInfo,
    CommitFile,
    PushConfig,
    StashItem,
    CommitViewMessage,
    PushViewMessage,
    WebviewMessage,
    CommitViewExtMessage,
    PushViewExtMessage,
    ExtensionMessage,
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
    commits: import('@shared/messages').CommitInfo[];
    files: import('@shared/messages').CommitFile[];
    config: import('@shared/messages').PushConfig;
}
