/**
 * Shared message types for webview ↔ extension communication.
 * Both extension host and webview-ui should import from this file.
 */

// ============================================
// Commit View Messages (Webview → Extension)
// ============================================

export interface CommitViewState {
    viewMode: 'tree' | 'list';
    activeTab: 'commit' | 'stash';
    commitMessage: string;
    amend: boolean;
    selectedFiles: string[];
    collapsedGroups: string[];
}

export type CommitViewMessage =
    | { type: 'refresh' }
    | { type: 'commit'; message: string; amend: boolean; files: string[] }
    | { type: 'commitAndPush'; message: string; amend: boolean; files: string[] }
    | { type: 'stage'; path: string }
    | { type: 'unstage'; path: string }
    | { type: 'stage-all' }
    | { type: 'unstage-all' }
    | { type: 'switchBranch'; branch: string }
    | { type: 'pickBranch' } // Request to open branch picker
    | { type: 'updateProject' }
    | { type: 'requestPush' }
    | { type: 'openFile'; path: string; status?: string }
    | { type: 'getLastCommitMessage' }
    | { type: 'generateCommitMessage' }
    | { type: 'stash'; files: string[] }
    | { type: 'rollback'; files: string[] }
    | { type: 'getChangedFiles' }
    | { type: 'getStashList' }
    | { type: 'stashApply'; index: number }
    | { type: 'stashPop'; index: number }
    | { type: 'stashDrop'; index: number }
    | { type: 'getStashFiles'; index: number }
    | { type: 'showStashFileDiff'; index: number; filePath: string }
    | { type: 'showStashActions'; index: number }
    | { type: 'rollbackWithPick' }
    | { type: 'createChangelist'; name: string }
    | { type: 'moveFiles'; files: string[]; targetListId: string }
    | { type: 'deleteChangelist'; id: string }
    | { type: 'renameChangelist'; id: string; name: string }
    | { type: 'promptCreateChangelist'; file?: string }
    | { type: 'deleteFiles'; files: string[] }
    | { type: 'deleteFiles'; files: string[] }
    | { type: 'stashChangelist'; files: string[] }
    | { type: 'fetch' }
    | { type: 'pull' }
    | { type: 'log'; message: string };

// ============================================
// Push View Messages (Webview → Extension)
// ============================================

export type PushViewMessage =
    | { type: 'ready' }
    | { type: 'push'; force: boolean; pushTags: boolean }
    | { type: 'cancel' }
    | { type: 'selectCommit'; index: number }
    | { type: 'openDiff'; path: string }
    | { type: 'changeRemote'; remote: string }
    | { type: 'changeRemoteBranch'; branch: string };

// Combined: All messages from Webview → Extension
export type WebviewMessage = CommitViewMessage | PushViewMessage;

// ============================================
// Extension → Webview Messages
// ============================================

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

// Commit View: Extension → Webview
export type CommitViewExtMessage =
    | { type: 'update'; files: ChangelistGroup[]; branches: BranchInfo; incomingCommits?: number }
    | { type: 'stashList'; stashList: StashItem[] }
    | { type: 'stashFiles'; index: number; files: FileStatus[] }
    | { type: 'clearMessage' }
    | { type: 'lastCommitMessage'; message: string }
    | { type: 'generatedCommitMessage'; message: string }
    | { type: 'aiGenerating'; generating: boolean }
    | { type: 'switchTab'; tab: 'commit' | 'stash' }
    | { type: 'activeFileChange'; path: string };

// Push View: Extension → Webview
export type PushViewExtMessage =
    | { type: 'update'; commits: CommitInfo[]; files: CommitFile[]; config: PushConfig }
    | { type: 'updateFiles'; files: CommitFile[] }
    | { type: 'pushComplete' }
    | { type: 'pushError' };

// Combined: All messages from Extension → Webview
export type ExtensionMessage = CommitViewExtMessage | PushViewExtMessage;

// ============================================
// Handler Types
// ============================================

export type MessageHandler<T> = (data: T) => void | Promise<void>;

export type CommitViewHandlers = {
    [K in CommitViewMessage['type']]?: MessageHandler<Extract<CommitViewMessage, { type: K }>>;
};

export type PushViewHandlers = {
    [K in PushViewMessage['type']]?: MessageHandler<Extract<PushViewMessage, { type: K }>>;
};
