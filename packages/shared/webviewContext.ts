export const WEBVIEW_CONTEXT_SECTIONS = [
    'commitGenerateButton',
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
    'changelistFolder',
    'changelistFile',
    'changelistHunk',
    'changelistBackground'
] as const;

export type WebviewContextSection = typeof WEBVIEW_CONTEXT_SECTIONS[number];

interface BaseWebviewContext {
    webviewSection: WebviewContextSection;
    preventDefaultContextMenuItems?: boolean;
}

export interface StashItemContext extends BaseWebviewContext {
    webviewSection: 'stashItem';
    stashIndex: number;
    selectedStashFile?: string | null;
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
    changelistMode: 'staged' | 'changes';
    preventDefaultContextMenuItems: true;
}

export interface ChangelistFolderContext extends BaseWebviewContext {
    webviewSection: 'changelistFolder';
    path: string;
    paths: string[];
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

export interface ChangelistFileContext extends BaseWebviewContext {
    webviewSection: 'changelistFile';
    path: string;
    paths: string[];
    hunkIds?: string[];
    status?: string;
    isStaged: boolean;
    isConflict: boolean;
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

export type WebviewContextPayload =
    | StashItemContext
    | GitLogCommitContext
    | GitLogCommitFileContext
    | ChangelistRootContext
    | ChangelistFolderContext
    | ChangelistFileContext
    | ChangelistBackgroundContext
    | BaseWebviewContext;
