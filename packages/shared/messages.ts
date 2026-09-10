/**
 * Shared message types for webview ↔ extension communication.
 * Both extension host and webview-ui should import from this file.
 */

export type GitStatusCode = 'A' | 'M' | 'D' | 'R' | 'C' | 'U' | '?';

export type RemoteProvider = 'github' | 'gitlab' | 'bitbucket' | 'azure' | 'unknown';

export interface RemoteLinkCapabilities {
    commit: boolean;
    branch: boolean;
    file: boolean;
    compare: boolean;
}

export interface RemoteLinkInfo {
    provider: RemoteProvider;
    repositoryUrl?: string;
    capabilities: RemoteLinkCapabilities;
}

export const AI_GENERATION_TIMEOUT_MS = 120000;

export type AiProviderId = 'copilot' | 'anthropic' | 'google' | 'custom' | 'codex';

export interface AiProviderStatus {
    provider: AiProviderId;
    label: string;
    model: string;
    isConfigured: boolean;
    canSelectModel: boolean;
    detail?: string;
}

export interface AiProviderTestResult {
    ok: boolean;
    message: string;
}

export const AI_PROVIDER_SETUP_REQUIRED_CODE = 'AI_PROVIDER_SETUP_REQUIRED';
export const AI_COPILOT_MODEL_UNAVAILABLE_CODE = 'AI_COPILOT_MODEL_UNAVAILABLE';

export type CommitMessageGenerationMode = 'full' | 'subject' | 'body' | 'rewrite';

export type CommitAiAction =
    | 'generateMessage'
    | 'generateSubject'
    | 'generateBody'
    | 'rewriteSelection'
    | 'configureProvider'
    | 'selectCopilotModel'
    | 'testProvider'
    | 'openCommitPromptSettings';

export interface CommitMessageGenerationRequest {
    files?: FileReferenceInput[];
    mode?: CommitMessageGenerationMode;
    currentMessage?: string;
    selectedText?: string;
    amend?: boolean;
}

export interface CommitMessageGenerationResult {
    message: string;
    mode: CommitMessageGenerationMode;
    fileCount: number;
    hunkCount: number;
}

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

export interface RepositoryFileReference {
    repoPath?: string;
    path: string;
}

export type ConflictResolverOpenRequest = RepositoryFileReference;

export type ConflictResolverContextAction =
    | 'acceptLeft'
    | 'cancelLeft'
    | 'acceptRight'
    | 'cancelRight'
    | 'markReviewed';

export interface ConflictResolverContextActionRequest extends RepositoryFileReference {
    groupId: string;
    action: ConflictResolverContextAction;
}

export type FileReferenceInput = string | RepositoryFileReference;

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

export interface RepositoryInfo {
    name: string;
    path: string;
    repoPath: string;
    workspaceRoot: string;
    gitRoot: string;
    gitDir?: string;
    isSubmodule: boolean;
    kind?: 'workspace' | 'submodule' | 'worktree';
    mainWorktreePath?: string;
    branch?: string;
    head?: string;
    isDetached?: boolean;
}

export interface RepositoryCommitViewState {
    repository: RepositoryInfo;
    files: FileStatus[];
    changelistState: ChangelistState;
    workspaceRoot: string;
}

export interface CommitViewState {
    files: FileStatus[];
    changelistState: ChangelistState;
    workspaceRoot: string;
    hasRepository?: boolean;
    repositories?: RepositoryCommitViewState[];
    activeRepository?: RepositoryInfo;
    cacheSessionId?: string;
}

export interface PushTarget {
    remote: string;
    branch: string;
}

export type PushFailureCode = 'behind' | 'auth-failed' | 'network' | 'rejected' | 'cancelled' | 'unknown';

export interface PushRequest {
    force: boolean;
    pushTags: boolean;
    noVerify?: boolean;
    remote: string;
    branch: string;
    commitCount?: number;
}

export interface PublishReviewBranchResult {
    remote: string;
    baseBranch: string;
    sourceBranch: string;
    branchName: string;
    compareUrl?: string;
    baseBranchReset: boolean;
    resetWarning?: string;
}

export interface PublishReviewBranchRequest {
    remote: string;
    baseBranch: string;
    commitCount?: number;
    noVerify?: boolean;
}

export interface ChangelistFileSelection {
    repoPath?: string;
    path: string;
    status?: string;
    staged?: boolean;
    inactive?: boolean;
    isConflict?: boolean;
}

export interface ConflictSideContent {
    exists: boolean;
    content: string;
    objectId?: string;
}

export type ConflictFileKind = 'text' | 'binary' | 'submodule' | 'unsupported';

export interface ConflictChange {
    id: string;
    baseStart: number;
    baseLineCount: number;
    sideStart: number;
    sideLineCount: number;
}

export interface ConflictFileContent {
    repoPath?: string;
    path: string;
    baseLabel?: string;
    currentLabel?: string;
    incomingLabel?: string;
    base: ConflictSideContent;
    current: ConflictSideContent;
    incoming: ConflictSideContent;
    currentChanges: ConflictChange[];
    incomingChanges: ConflictChange[];
    result: string;
    stageSignature: string;
    resultFingerprint: string;
    resolvedCandidate: boolean;
    isBinary: boolean;
    kind: ConflictFileKind;
}

export interface ConflictResolutionSnapshot {
    stageSignature: string;
    resultFingerprint: string;
}

export interface SaveConflictResolutionRequest extends RepositoryFileReference, ConflictResolutionSnapshot {
    content: string;
    resultExists: boolean;
}

export interface ResolveConflictRequest extends RepositoryFileReference, ConflictResolutionSnapshot {
    side: 'ours' | 'theirs';
}

export interface BranchInfo {
    current: string;
    all: string[];
    ahead?: number;
    behind?: number;
    rebaseStatus?: 'none' | 'interactive' | 'merging';
    repositoryName?: string;
    repositoryKind?: RepositoryInfo['kind'];
    repositoryDetached?: boolean;
    repositoryPath?: string;
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
    repoPath?: string;
    targetListId: string;
    paths?: string[];
    hunksByPath?: Record<string, string[]>;
    activateInactive?: boolean;
}

export interface WorktreeInfo {
    path: string;
    branch?: string;
    head?: string;
    isDetached?: boolean;
    isCurrent: boolean;
    isActiveRepository: boolean;
    pathExists: boolean;
    isPrunable: boolean;
    isDirty: boolean;
}

export interface ExtensionMethods {
    getRepositories: () => Promise<RepositoryInfo[]>;
    getActiveRepository: () => Promise<string | undefined>;
    setActiveRepository: (repoPath: string) => Promise<boolean>;
    addRepository: () => Promise<RepositoryInfo | undefined>;
    scanWorkspaceRepositories: () => Promise<RepositoryInfo[]>;
    removeRepository: (repoPath: string) => Promise<boolean>;
    getWorktrees: () => Promise<WorktreeInfo[]>;
    setActiveWorktree: (path: string) => Promise<boolean>;
    openWorktree: (path: string) => Promise<void>;
    revealWorktree: (path: string) => Promise<void>;
    pruneWorktrees: () => Promise<void>;
    removeWorktree: (path: string, force?: boolean) => Promise<void>;
    log(params: { message: string; type?: 'info' | 'error' | 'warn' | 'debug' }): Promise<void>;
    getPushInitState: () => Promise<PushInitState>;
    getRemoteBranches: (remote: string) => Promise<string[]>;
    getPushCommits: (params: { remote: string; branch: string; limit?: number; skip?: number }) => Promise<PushCommitsData>;
    getCommitFiles: (hash: string) => Promise<CommitFile[]>;
    getMultiCommitFiles: (hashes: string[]) => Promise<CommitFile[]>;
    push: (params: PushRequest) => Promise<PushResult>;
    publishReviewBranch: (params: PublishReviewBranchRequest) => Promise<PublishReviewBranchResult | null>;
    confirmForcePush: (params: { remote: string; branch: string }) => Promise<boolean>;
    openDiff: (path: string | { path: string; repoPath?: string; staged?: boolean }, staged?: boolean) => Promise<void>;
    closeWebView: () => Promise<void>;
    openCommitDiff: (params: { path: string; leftRef: string; rightRef: string; preserveFocus?: boolean }) => Promise<void>;
    getStatus: () => Promise<FileStatus[]>;
    getChangelistState: () => Promise<ChangelistState>;
    getCommitViewState: () => Promise<CommitViewState>;
    invalidateCommitViewState: () => Promise<void>;
    getBranchInfo: () => Promise<BranchInfo>;
    getStashList: () => Promise<StashItem[]>;
    getStashFiles: (index: number) => Promise<CommitFile[]>;
    commit: (params: { message: string; amend: boolean; files: FileReferenceInput[]; push?: boolean; pushTarget?: PushTarget }) => Promise<void>;
    stage: (path: FileReferenceInput) => Promise<void>;
    stageFiles: (paths: FileReferenceInput[]) => Promise<void>;
    unstage: (path: FileReferenceInput) => Promise<void>;
    unstageFiles: (paths: FileReferenceInput[]) => Promise<void>;
    stageAll: () => Promise<void>;
    unstageAll: () => Promise<void>;
    stageTracked: () => Promise<void>;
    getAIProviderStatus: () => Promise<AiProviderStatus>;
    generateCommitMessage: (request?: CommitMessageGenerationRequest) => Promise<CommitMessageGenerationResult>;
    testAIProvider: () => Promise<AiProviderTestResult>;
    selectCopilotModel: () => Promise<void>;
    openCommitPromptSettings: () => Promise<void>;
    stash: (params: { message?: string; files: FileReferenceInput[]; stagedOnly?: boolean }) => Promise<void>;
    deleteFiles: (files: FileReferenceInput[]) => Promise<void>;
    rollback: (files: FileReferenceInput[]) => Promise<void>;
    switchBranch: (branch: string) => Promise<void>;
    pull: () => Promise<void>;
    fetch: () => Promise<void>;
    focusGitLog: () => Promise<void>;
    switchRepository: () => Promise<void>;
    openFolder: () => Promise<void>;
    openFeedback: () => Promise<void>;
    openLatestRelease: () => Promise<void>;
    rebuildDevVsix: () => Promise<void>;
    initializeRepository: () => Promise<void>;
    configureAIProvider: () => Promise<void>;
    pickBranch: () => Promise<void>;
    continueRebase: (params: { message?: string; files?: string[] }) => Promise<void>;
    abortRebase: () => Promise<void>;
    openConflictResolver: (params: ConflictResolverOpenRequest) => Promise<void>;
    updateConflictResolverTitle: (params: { path: string; repoPath?: string }) => Promise<void>;
    getConflictFileContent: (params: { path: string; repoPath?: string }) => Promise<ConflictFileContent>;
    confirmConflictResolverRestart: () => Promise<boolean>;
    saveConflictResolution: (params: SaveConflictResolutionRequest) => Promise<void>;
    resolveConflict: (params: ResolveConflictRequest) => Promise<void>;
    openFile: (params: { path: string; repoPath?: string; preserveFocus?: boolean }) => Promise<void>;
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
    markHunkInactive: (params: { path: string; repoPath?: string; hunkId: string }) => Promise<void>;
    markHunkActive: (params: { path: string; repoPath?: string; hunkId: string }) => Promise<void>;
    markFilesInactive: (paths: FileReferenceInput[]) => Promise<void>;
    markFilesActive: (paths: FileReferenceInput[]) => Promise<void>;
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
    repositoryPath?: string;
    localBranch: string;
    remotes: string[];
    upstream?: string;
    protectedPushTargets?: string[];
}

export interface PushCommitsData {
    commits: CommitDetails[];
    hasMore: boolean;
    totalCount: number;
}

export type PushResult = PushSuccessResult | PushFailedResult;

export interface PushSuccessResult {
    ok: true;
    remote: string;
    branch: string;
    commitCount: number;
}

export interface PushFailedResult {
    ok: false;
    code: PushFailureCode;
    remote: string;
    branch: string;
    message: string;
    behindCount?: number;
}

export type RefreshScope = 'commit' | 'branch' | 'worktrees' | 'push' | 'stash' | 'gitLog';

export interface RefreshEvent {
    scopes: RefreshScope[];
    reason?: string;
}

export interface FileDiagnosticsChange {
    repoPath: string;
    files: Array<{
        path: string;
        error: boolean;
    }>;
}

export interface WebviewMethods {
    activeFileChange: (params: { path: string; commitHash?: string }) => void;
    revealConflictResolverFile: (params: ConflictResolverOpenRequest) => void;
    triggerConflictResolverAction: (params: ConflictResolverContextActionRequest) => void;
    revealLog: (params: GitLogRevealRequest) => void;
    filterLogByBranch: (params: { branch: string }) => void;
    refresh: (event: RefreshEvent) => void;
    fileDiagnosticsChange: (change: FileDiagnosticsChange) => void;
    switchTab: (tab: 'commit' | 'stash' | 'push') => void;
    toggleWorktreesDrawer: () => void;
    triggerCommitAiAction: (action: CommitAiAction) => void;
}

export interface LocalBranchInfo {
    name: string;
    ahead: number;
    behind: number;
    upstream?: string;
}

export interface BranchListData {
    hasRepository?: boolean;
    repository?: RepositoryInfo;
    currentBranch: string;
    localBranches: string[];
    localBranchesInfo: LocalBranchInfo[];
    remoteBranches: Record<string, string[]>;
    tags: string[];
}
