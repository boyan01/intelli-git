export const WEBVIEW_CONTEXT_SECTIONS = [
    'commitGenerateButton',
    'commitMessageInput',
    'commitItem',
    'pushCommit',
    'authorName',
    'stashItem',
    'localBranch',
    'remoteBranch',
    'tag',
    'gitLogCommit',
    'gitLogCommitFile',
    'changelistRoot',
    'changelistRepository',
    'changelistFolder',
    'changelistFile',
    'changelistHunk',
    'changelistBackground',
    'worktreeItem'
] as const;

export type WebviewContextSection = typeof WEBVIEW_CONTEXT_SECTIONS[number];

interface BaseWebviewContext {
    webviewSection: WebviewContextSection;
    preventDefaultContextMenuItems?: boolean;
}

export interface CommitAiContext extends BaseWebviewContext {
    webviewSection: 'commitGenerateButton' | 'commitMessageInput';
    hasSelectedChanges: boolean;
    hasCommitMessageSelection: boolean;
    canSelectCopilotModel?: boolean;
    preventDefaultContextMenuItems?: false;
}

export interface StashItemContext extends BaseWebviewContext {
    webviewSection: 'stashItem';
    stashIndex: number;
    selectedStashFile?: string | null;
}

export interface BranchContext extends BaseWebviewContext {
    webviewSection: 'localBranch' | 'remoteBranch';
    branchName: string;
    fullBranchName: string;
    hasUpstream?: boolean;
}

export interface TagContext extends BaseWebviewContext {
    webviewSection: 'tag';
    tagName: string;
}

export interface GitLogCommitContext extends BaseWebviewContext {
    webviewSection: 'gitLogCommit';
    hash: string;
    shortHash: string;
    subject: string;
    isUnpushed: boolean;
    isLatestUnpushed: boolean;
}

export interface GitLogCommitFileContext extends BaseWebviewContext {
    webviewSection: 'gitLogCommitFile';
    path?: string;
    status?: string;
    isFile?: boolean;
    commitHash: string;
    parentHash: string;
}

export interface ChangelistRootContext extends BaseWebviewContext {
    webviewSection: 'changelistRoot';
    repoPath?: string;
    changelistId?: string;
    paths: string[];
    isActiveChangelist: boolean;
    canSetActiveChangelist: boolean;
    canDeleteChangelist: boolean;
    hasConflict: boolean;
    hasInactive: boolean;
    allInactive: boolean;
    hasStaged: boolean;
    allStaged: boolean;
    hasUntracked: boolean;
    hasResolvedCandidate?: boolean;
    changelistMode: 'staged' | 'changes';
    preventDefaultContextMenuItems: true;
}

export interface ChangelistRepositoryContext extends BaseWebviewContext {
    webviewSection: 'changelistRepository';
    repoPath: string;
    paths: string[];
    hasConflict: boolean;
    hasInactive: boolean;
    allInactive: boolean;
    hasStaged: boolean;
    allStaged: boolean;
    hasUntracked: boolean;
    hasResolvedCandidate?: boolean;
    changelistId?: string;
    changelistMode: 'staged' | 'changes';
    preventDefaultContextMenuItems: true;
}

export interface ChangelistFolderContext extends BaseWebviewContext {
    webviewSection: 'changelistFolder';
    repoPath?: string;
    path: string;
    paths: string[];
    hasConflict: boolean;
    hasInactive: boolean;
    allInactive: boolean;
    hasStaged: boolean;
    allStaged: boolean;
    hasUntracked: boolean;
    hasResolvedCandidate?: boolean;
    changelistId?: string;
    changelistMode: 'staged' | 'changes';
    preventDefaultContextMenuItems: true;
}

export interface ChangelistFileContext extends BaseWebviewContext {
    webviewSection: 'changelistFile';
    repoPath?: string;
    path: string;
    paths: string[];
    hunkIds?: string[];
    status?: string;
    isStaged: boolean;
    isConflict: boolean;
    resolvedCandidate?: boolean;
    hasResolvedCandidate?: boolean;
    isInactive: boolean;
    isUntracked: boolean;
    hasConflict: boolean;
    hasInactive: boolean;
    allInactive: boolean;
    hasStaged: boolean;
    allStaged: boolean;
    hasUntracked: boolean;
    changelistId?: string;
    changelistMode: 'staged' | 'changes';
    preventDefaultContextMenuItems: true;
}

export interface ChangelistBackgroundContext extends BaseWebviewContext {
    webviewSection: 'changelistBackground';
    changelistMode: 'staged' | 'changes';
    preventDefaultContextMenuItems: true;
}

export interface WorktreeItemContext extends BaseWebviewContext {
    webviewSection: 'worktreeItem';
    path: string;
    branch?: string;
    pathExists: boolean;
    isCurrent: boolean;
    isActiveRepository: boolean;
    isDirty: boolean;
    isPrunable: boolean;
    preventDefaultContextMenuItems: true;
}

export type WebviewContextPayload =
    | CommitAiContext
    | StashItemContext
    | BranchContext
    | TagContext
    | GitLogCommitContext
    | GitLogCommitFileContext
    | ChangelistRootContext
    | ChangelistRepositoryContext
    | ChangelistFolderContext
    | ChangelistFileContext
    | ChangelistBackgroundContext
    | WorktreeItemContext
    | BaseWebviewContext;
