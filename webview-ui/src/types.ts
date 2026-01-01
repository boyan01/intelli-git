export interface FileStatus {
    path: string;
    status: string;
    staged: boolean;
}

export interface Changelist {
    id: string;
    name: string;
    description?: string;
    isDefault: boolean;
    files: string[];
}

export interface ChangelistGroup extends Changelist {
    items: FileStatus[];
}

export interface BranchInfo {
    current: string;
    all: string[];
}


export interface CommitInfo {
    hash: string;
    shortHash: string;
    subject: string;
    authorName: string;
    date: string;
}

export interface CommitFile {
    path: string;
    status: string;
}

export interface PushConfig {
    currentBranch: string;
    remote: string;
    remoteBranch: string;
    remotes: string[];
    remoteBranches: string[];
}

export interface PushState {
    commits: CommitInfo[];
    files: CommitFile[];
    config: PushConfig;
}

// Messages derived from VS Code extension
export type MessageToWebview = 
    | { type: 'update'; files: ChangelistGroup[]; branches: BranchInfo }
    | { type: 'stash-update'; list: any[] }
    // Push View Messages
    | { type: 'push-update'; commits: CommitInfo[]; files: CommitFile[]; config: PushConfig }
    | { type: 'push-updateFiles'; files: CommitFile[] }
    | { type: 'pushComplete' }
    | { type: 'pushError' };

