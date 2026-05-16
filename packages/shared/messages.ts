/**
 * Shared message types for webview ↔ extension communication.
 * Both extension host and webview-ui should import from this file.
 */

export type GitStatusCode = 'A' | 'M' | 'D' | 'R' | 'C' | 'U' | '?';

export interface GitHunk {
    id: string; // File path + change block signature (e.g., oldStart/newStart/content hash)
    lineRange: string; // e.g., "L10-20"
    fileHeader: string; // The file-level diff header required to apply the change block patch
    content: string; // The diff content of the change block
    oldStart: number;
    newStart: number;
    oldLineCount: number;
    newLineCount: number;
}

export interface FileStatus {
    path: string;
    displayPath?: string;
    status: GitStatusCode;
    staged: boolean;
    inactive?: boolean;
    hunks?: GitHunk[];
    inactiveHunkIds?: string[];
    resolvedCandidate?: boolean;
    error?: boolean;
    hasStagedInactive?: boolean;
}

export interface ChangelistGroup {
    id: string;
    name: string;
    isDefault: boolean;
    items: FileStatus[];
    hasWarning?: boolean;
    isActive?: boolean;
}

export type ChangelistMode = 'staged' | 'changes';

export interface ChangelistInfo {
    id: string;
    name: string;
    isDefault: boolean;
    isActive: boolean;
}

export interface ChangelistAssignment {
    fileListId?: string;
    hunkListIds?: Record<string, string>;
}

export interface ChangelistState {
    mode: ChangelistMode;
    activeListId: string;
    lists: ChangelistInfo[];
    assignments: Record<string, ChangelistAssignment>;
}

export interface CommitViewState {
    files: FileStatus[];
    changelistState: ChangelistState;
    workspaceRoot: string;
    hasRepository?: boolean;
}

export interface ChangelistFileSelection {
    path: string;
    status?: string;
    staged?: boolean;
    inactive?: boolean;
    isConflict?: boolean;
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
    displayPath?: string;
    status: GitStatusCode;
}

export interface LastCommitInfo {
    hash: string;
    shortHash: string;
    subject: string;
    message: string;
    files: CommitFile[];
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

export interface GitLogRevealRequest {
    hash?: string;
    path?: string;
}

export interface ChangelistMoveRequest {
    targetListId: string;
    paths?: string[];
    hunksByPath?: Record<string, string[]>;
    activateInactive?: boolean;
}

export interface RepositoryInfo {
    name: string;
    path: string;
    repoPath: string;
    workspaceRoot: string;
    gitRoot: string;
    isSubmodule: boolean;
}

export interface ExtensionMethods {
    getRepositories: () => Promise<RepositoryInfo[]>;
    getActiveRepository: () => Promise<string | undefined>;
    setActiveRepository: (repoPath: string) => Promise<boolean>;
    log(params: { message: string; type?: 'info' | 'error' | 'warn' | 'debug' }): Promise<void>;
    getPushInitState: () => Promise<PushInitState>;
    getRemoteBranches: (remote: string) => Promise<string[]>;
    getPushCommits: (params: { remote: string; branch: string; limit?: number; skip?: number }) => Promise<PushCommitsData>;
    getCommitFiles: (hash: string) => Promise<CommitFile[]>;
    getMultiCommitFiles: (hashes: string[]) => Promise<CommitFile[]>;
    push: (params: { force: boolean; pushTags: boolean; noVerify?: boolean; remote: string; branch: string }) => Promise<void>;
    openDiff: (path: string, staged?: boolean) => Promise<void>;
    closeWebView: () => Promise<void>;
    openCommitDiff: (params: { path: string; leftRef: string; rightRef: string; preserveFocus?: boolean }) => Promise<void>;
    getStatus: () => Promise<FileStatus[]>;
    getChangelistState: () => Promise<ChangelistState>;
    getCommitViewState: () => Promise<CommitViewState>;
    getBranchInfo: () => Promise<BranchInfo>;
    getStashList: () => Promise<StashItem[]>;
    getStashFiles: (index: number) => Promise<CommitFile[]>;
    commit: (params: { message: string; amend: boolean; files: string[]; push?: boolean }) => Promise<void>;
    stage: (path: string) => Promise<void>;
    stageFiles: (paths: string[]) => Promise<void>;
    unstage: (path: string) => Promise<void>;
    unstageFiles: (paths: string[]) => Promise<void>;
    stageAll: () => Promise<void>;
    unstageAll: () => Promise<void>;
    stageTracked: () => Promise<void>;
    generateCommitMessage: (files?: string[]) => Promise<string>;
    stash: (params: { message?: string; files: string[]; stagedOnly?: boolean }) => Promise<void>;
    deleteFiles: (files: string[]) => Promise<void>;
    rollback: (files: string[]) => Promise<void>;
    switchBranch: (branch: string) => Promise<void>;
    pull: () => Promise<void>;
    fetch: () => Promise<void>;
    focusGitLog: () => Promise<void>;
    switchRepository: () => Promise<void>;
    openFolder: () => Promise<void>;
    initializeRepository: () => Promise<void>;
    pickBranch: () => Promise<void>;
    continueRebase: (params: { message?: string; files?: string[] }) => Promise<void>;
    abortRebase: () => Promise<void>;
    resolveConflict: (params: { path: string; side: 'ours' | 'theirs' }) => Promise<void>;
    openFile: (params: { path: string; preserveFocus?: boolean }) => Promise<void>;
    openStashDiff: (params: { index: number; path: string }) => Promise<void>;
    getBranchListData: () => Promise<BranchListData>;
    getLog: (options: LogOptions) => Promise<LogCommit[]>;
    getCommitDetails: (hash: string) => Promise<CommitDetails>;
    getPendingGitLogReveal: () => Promise<GitLogRevealRequest | undefined>;
    pickBranchForFilter: () => Promise<string | undefined>;
    pickPaths: () => Promise<string[] | undefined>;
    getAuthors: () => Promise<string[]>;
    getCurrentUser: () => Promise<string>;
    getUnpushedCommits: () => Promise<string[]>;
    getWorkspaceRoot: () => Promise<string>;
    getLastCommitInfo: () => Promise<LastCommitInfo | null>;
    showErrorMessage: (message: string) => Promise<void>;
    markHunkInactive: (params: { path: string; hunkId: string }) => Promise<void>;
    markHunkActive: (params: { path: string; hunkId: string }) => Promise<void>;
    markFilesInactive: (paths: string[]) => Promise<void>;
    markFilesActive: (paths: string[]) => Promise<void>;
    setChangelistMode: (mode: ChangelistMode) => Promise<void>;
    createChangelist: (name?: string) => Promise<ChangelistInfo | null>;
    renameChangelist: (params: { id: string; name?: string }) => Promise<ChangelistInfo | null>;
    deleteChangelist: (id: string) => Promise<void>;
    setActiveChangelist: (id: string) => Promise<void>;
    moveChangesToChangelist: (params: ChangelistMoveRequest) => Promise<void>;
    moveFilesToChangelist: (params: { paths: string[]; targetListId: string }) => Promise<void>;
    moveHunksToChangelist: (params: { path: string; hunkIds: string[]; targetListId: string }) => Promise<void>;
    setActiveChangelistFile: (params: ChangelistFileSelection | null) => Promise<void>;
    setChangelistTreeFocus: (focused: boolean) => Promise<void>;
}


export interface PushInitState {
    localBranch: string;
    remotes: string[];
    upstream?: string;
}

export interface PushCommitsData {
    commits: CommitDetails[];
    hasMore: boolean;
    totalCount: number;
}

export interface WebviewMethods {
    activeFileChange: (params: { path: string; commitHash?: string }) => void;
    revealLog: (params: GitLogRevealRequest) => void;
    filterLogByBranch: (params: { branch: string }) => void;
    refresh: () => void;
    switchTab: (tab: 'commit' | 'stash' | 'push') => void;
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
