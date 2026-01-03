/**
 * Shared message types for webview ↔ extension communication.
 * Both extension host and webview-ui should import from this file.
 */

export interface FileStatus {
    path: string;
    status: string;
    staged: boolean;
}

export interface ChangelistGroup {
    id: string;
    name: string;
    isDefault: boolean;
    items: FileStatus[];
}

export interface BranchInfo {
    current: string;
    all: string[];
    ahead?: number;
    behind?: number;
    rebaseStatus?: 'none' | 'interactive' | 'merging';
}

export interface StashItem {
    index: number;
    message: string;
    branch: string;
}

export interface CommitInfo {
    hash: string;
    shortHash: string;
    subject: string;
    authorName: string;
    email?: string;
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



export interface PushData {
    commits: CommitInfo[];
    files: CommitFile[];
    config: PushConfig;
}

export interface ExtensionMethods {
    log(message: string): Promise<void>;
    getPushInitState: () => Promise<PushInitState>;
    getRemoteBranches: (remote: string) => Promise<string[]>;
    getPushCommits: (params: { remote: string; branch: string }) => Promise<PushCommitsData>;
    getCommitFiles: (hash: string) => Promise<CommitFile[]>;
    getMultiCommitFiles: (hashes: string[]) => Promise<CommitFile[]>;
    push: (params: { force: boolean; pushTags: boolean; remote: string; branch: string }) => Promise<void>;
    openDiff: (path: string) => Promise<void>;
    closeWebView: () => Promise<void>;
    openCommitDiff: (params: { path: string; leftRef: string; rightRef: string }) => Promise<void>;
    getCommitState: () => Promise<CommitState>;
    getChangelists: () => Promise<ChangelistGroup[]>;
    getBranchInfo: () => Promise<BranchInfo>;
    getStashList: () => Promise<StashItem[]>;
    getStashFiles: (index: number) => Promise<CommitFile[]>;
    commit: (params: { message: string; amend: boolean; files: string[]; push?: boolean }) => Promise<void>;
    stage: (path: string) => Promise<void>;
    unstage: (path: string) => Promise<void>;
    stageAll: () => Promise<void>;
    unstageAll: () => Promise<void>;
    generateCommitMessage: (files?: string[]) => Promise<string>;
    stash: (params: { message?: string; files: string[] }) => Promise<void>;
    deleteFiles: (files: string[]) => Promise<void>;
    rollback: (files: string[]) => Promise<void>;
    switchBranch: (branch: string) => Promise<void>;
    pull: () => Promise<void>;
    fetch: () => Promise<void>;
    createChangelist: (name: string) => Promise<void>;
    pickBranch: () => Promise<void>;
    continueRebase: (params: { message?: string; files?: string[] }) => Promise<void>;
    abortRebase: () => Promise<void>;
    moveFiles: (params: { files: string[]; targetListId: string }) => Promise<void>;
    deleteChangelist: (id: string) => Promise<void>;
    renameChangelist: (params: { id: string; name: string }) => Promise<void>;
    promptCreateChangelist: (file?: string) => Promise<void>;
    openFile: (params: { path: string }) => Promise<void>;
}

export interface CommitState {
    changelists: ChangelistGroup[];
    branches: BranchInfo;
    incomingCommits: number;
    stashList: StashItem[];
    recentCommitMessage?: string;
}

export interface PushInitState {
    localBranch: string;
    remotes: string[];
}

export interface PushCommitsData {
    commits: CommitInfo[];
    files: CommitFile[];
}

export interface WebviewMethods {
    activeFileChange: (params: { path: string }) => void;
    refresh: () => void;
}
