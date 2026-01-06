/**
 * Shared message types for webview ↔ extension communication.
 * Both extension host and webview-ui should import from this file.
 */

export type GitStatusCode = 'A' | 'M' | 'D' | 'R' | 'C' | 'U' | '?';

export interface FileStatus {
    path: string;
    status: GitStatusCode;
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

export interface CommitFile {
    path: string;
    status: GitStatusCode;
}

export interface PushConfig {
    currentBranch: string;
    remote: string;
    remoteBranch: string;
    remotes: string[];
    remoteBranches: string[];
}

export interface RefInfo {
    name: string;
    type: 'local' | 'remote' | 'tag' | 'head';
}

export interface CommitDetails {
    hash: string;
    shortHash: string;
    subject: string;
    authorName: string;
    authorEmail: string;
    date: string;
    body: string;
    files: CommitFile[];
    stats: { additions: number; deletions: number };
    parentHashes: string[];
    containingBranches: string[];
    refs: RefInfo[];
    filteredAncestors: string[];
}

export type LogCommit = CommitDetails;

export interface PushData {
    commits: CommitDetails[];
    files: CommitFile[];
    config: PushConfig;
}

export interface LogOptions {
    branch?: string;
    authors?: string[];
    search?: string;
    regexMode?: boolean;
    caseSensitive?: boolean;
    maxCount?: number;
    skip?: number;
    fileFilter?: string;
    paths?: string[];
    since?: string;
    until?: string;
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
    getStatus: () => Promise<FileStatus[]>;
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
    openStashDiff: (params: { index: number; path: string }) => Promise<void>;
    getBranchListData: () => Promise<BranchListData>;
    getLog: (options: LogOptions) => Promise<LogCommit[]>;
    getCommitDetails: (hash: string) => Promise<CommitDetails>;
    pickBranchForFilter: () => Promise<string | undefined>;
    pickPaths: () => Promise<string[] | undefined>;
    getAuthors: () => Promise<string[]>;
    getCurrentUser: () => Promise<string>;
    getWorkspaceState: <T>(key: string) => Promise<T | undefined>;
    updateWorkspaceState: <T>(key: string, value: T) => Promise<void>;
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
    commits: CommitDetails[];
    files: CommitFile[];
}

export interface WebviewMethods {
    activeFileChange: (params: { path: string }) => void;
    refresh: () => void;
}

export interface LocalBranchInfo {
    name: string;
    ahead: number;
    behind: number;
    upstream?: string;
}

export interface BranchListData {
    currentBranch: string;
    localBranches: string[];
    localBranchesInfo: LocalBranchInfo[];
    remoteBranches: Record<string, string[]>;
    tags: string[];
}
