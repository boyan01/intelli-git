import * as vscode from 'vscode';
import * as path from 'path';
import { RpcPeer } from '@shared/rpc';
import type { WebviewMethods, ExtensionMethods, FileStatus, ChangelistFileSelection, ChangelistState, GitLogRevealRequest, BranchInfo, BranchListData, CommitDetails, CommitFile, LogCommit, LogOptions, PushCommitsData, PushInitState } from '@shared/messages';
import { GitService } from '../services/GitService';
import { RepositoryManager } from '../services/RepositoryManager';
import { ChangelistStateService } from '../services/ChangelistStateService';
import { InactiveChangesService } from '../services/InactiveChangesService';
import { AnthropicService } from '../services/AnthropicService';
import { GoogleAiService } from '../services/GoogleAiService';
import { OpenAiService } from '../services/CustomOpenAiService';
import { i18n } from '../utils/i18n';
import { AiProvider, DEFAULT_COMMIT_MESSAGE_PROMPT } from '../services/ai';
import { logger } from '../utils/logger';
import { getAiApiKey } from '../utils/aiSecrets';
import { createRevisionContentUri, createStashContentUri } from '../utils/repositoryContentUri';

export interface ExtensionRpcHandlerOptions {
    context: vscode.ExtensionContext;
    repositoryManager: RepositoryManager;
    onDispose?: () => void;
    onChangelistSelectionChange?: (selection: ChangelistFileSelection | null) => void;
    onChangelistFocusChange?: (focused: boolean) => void;
    consumePendingGitLogReveal?: () => GitLogRevealRequest | undefined;
}

/**
 * Full implementation of ExtensionMethods interface for RPC handling.
 * Encapsulates all Git and Changelist operations.
 */
export class ExtensionRpcHandler {
    private context: vscode.ExtensionContext;
    private repositoryManager: RepositoryManager;
    private onDispose: () => void;
    private onChangelistSelectionChange?: (selection: ChangelistFileSelection | null) => void;
    private onChangelistFocusChange?: (focused: boolean) => void;
    private consumePendingGitLogReveal?: () => GitLogRevealRequest | undefined;
    private _lastRebaseStatus?: string;

    constructor(options: ExtensionRpcHandlerOptions) {
        this.context = options.context;
        this.repositoryManager = options.repositoryManager;
        this.onDispose = options.onDispose || (() => { });
        this.onChangelistSelectionChange = options.onChangelistSelectionChange;
        this.onChangelistFocusChange = options.onChangelistFocusChange;
        this.consumePendingGitLogReveal = options.consumePendingGitLogReveal;
    }

    private get gitService(): GitService {
        const service = this.repositoryManager.getActiveService();
        if (!service) {
            throw new Error("No active repository");
        }
        return service;
    }

    private get inactiveChangesService(): InactiveChangesService | undefined {
        return this.repositoryManager.getActiveService()?.inactiveChangesService;
    }

    private get changelistStateService(): ChangelistStateService | undefined {
        return this.repositoryManager.getActiveService()?.changelistStateService;
    }

    log = (params: { message: string, type?: 'info' | 'error' | 'warn' | 'debug' }): Promise<void> => {
        const type = params.type || 'info';
        if (logger[type]) {
            logger[type](params.message);
        } else {
            logger.info(params.message);
        }
        return Promise.resolve();
    };

    private isBehindPushError(error: unknown): boolean {
        const message = error instanceof Error ? error.message : String(error);
        const normalizedMessage = message.toLowerCase();

        return (
            normalizedMessage.includes('non-fast-forward') ||
            normalizedMessage.includes('[rejected]') ||
            normalizedMessage.includes('fetch first') ||
            normalizedMessage.includes('failed to push some refs') ||
            normalizedMessage.includes('tip of your current branch is behind')
        );
    }

    private normalizeModelIdentifier(value: string | undefined): string {
        return (value || '').trim().toLowerCase();
    }

    getRepositories = async () => {
        return this.repositoryManager.getRepositories();
    };

    getActiveRepository = async () => {
        return this.repositoryManager.getActiveRepoPath();
    };

    setActiveRepository = async (repoPath: string) => {
        return this.repositoryManager.setActiveRepository(repoPath);
    };

    getPushInitState = async (): Promise<PushInitState> => {
        return this.repositoryManager.getActiveService()?.getPushInitState() ?? {
            localBranch: '',
            remotes: []
        };
    };

    getRemoteBranches = async (remote: string): Promise<string[]> => {
        return await this.repositoryManager.getActiveService()?.getRemoteBranchesForRemote(remote) ?? [];
    };

    getPushCommits = async (params: { remote: string; branch: string; limit?: number; skip?: number }): Promise<PushCommitsData> => {
        return await this.repositoryManager.getActiveService()?.getPushCommits(params) ?? {
            commits: [],
            hasMore: false,
            totalCount: 0
        };
    };

    getCommitFiles = async (hash: string): Promise<CommitFile[]> => {
        return await this.repositoryManager.getActiveService()?.getCommitFiles(hash) ?? [];
    };

    getMultiCommitFiles = async (hashes: string[]): Promise<CommitFile[]> => {
        return await this.repositoryManager.getActiveService()?.getMultiCommitFiles(hashes) ?? [];
    };

    getBranchInfo = async (): Promise<BranchInfo> => {
        return await this.repositoryManager.getActiveService()?.getRpcBranchInfo() ?? {
            current: '',
            all: [],
            rebaseStatus: 'none'
        };
    };

    getStashList = async () => {
        return await this.repositoryManager.getActiveService()?.getStashList() ?? [];
    };

    getStashFiles = async (index: number): Promise<CommitFile[]> => {
        return await this.repositoryManager.getActiveService()?.getStashFilesAsCommitFiles(index) ?? [];
    };

    getBranchListData = async (): Promise<BranchListData> => {
        return await this.repositoryManager.getActiveService()?.getBranchListData() ?? {
            currentBranch: '',
            localBranches: [],
            localBranchesInfo: [],
            remoteBranches: {},
            tags: []
        };
    };

    getLog = async (options: LogOptions): Promise<LogCommit[]> => {
        return await this.repositoryManager.getActiveService()?.getLog(options) ?? [];
    };

    getCommitDetails = async (hash: string): Promise<CommitDetails> => {
        return await this.repositoryManager.getActiveService()?.getCommitDetails(hash) ?? {
            hash,
            shortHash: hash.substring(0, 7),
            subject: '',
            authorName: '',
            authorEmail: '',
            date: '',
            body: '',
            files: [],
            stats: { additions: 0, deletions: 0 },
            parentHashes: [],
            containingBranches: [],
            refs: [],
            filteredAncestors: []
        };
    };

    getAuthors = async (): Promise<string[]> => {
        return await this.repositoryManager.getActiveService()?.getAuthors() ?? [];
    };

    getCurrentUser = async (): Promise<string> => {
        return await this.repositoryManager.getActiveService()?.getCurrentUser() ?? '';
    };

    getWorkspaceRoot = async (): Promise<string> => {
        return this.repositoryManager.getActiveService()?.getWorkspaceRoot() ?? '';
    };

    getLastCommitInfo = async () => {
        return await this.repositoryManager.getActiveService()?.getLastCommitInfo() ?? null;
    };

    registerAll(rpc: RpcPeer<WebviewMethods, ExtensionMethods>) {
        rpc.registerAll(
            {
                getRepositories: this.getRepositories,
                getActiveRepository: this.getActiveRepository,
                setActiveRepository: this.setActiveRepository,
                log: this.log,
                getPushInitState: this.getPushInitState,
                getRemoteBranches: this.getRemoteBranches,
                getPushCommits: this.getPushCommits,
                getCommitFiles: this.getCommitFiles,
                getMultiCommitFiles: this.getMultiCommitFiles,
                push: this.push,
                openDiff: this.openDiff,
                closeWebView: this.closeWebView,
                openCommitDiff: this.openCommitDiff,
                getStatus: this.getStatus,
                getChangelistState: this.getChangelistState,
                getCommitViewState: this.getCommitViewState,
                getBranchInfo: this.getBranchInfo,
                getStashList: this.getStashList,
                getStashFiles: this.getStashFiles,
                commit: this.commit,
                stage: this.stage,
                stageFiles: this.stageFiles,
                unstage: this.unstage,
                unstageFiles: this.unstageFiles,
                stageAll: this.stageAll,
                unstageAll: this.unstageAll,
                stageTracked: this.stageTracked,
                generateCommitMessage: this.generateCommitMessage,
                stash: this.stash,
                deleteFiles: this.deleteFiles,
                rollback: this.rollback,
                switchBranch: this.switchBranch,
                pull: this.pull,
                fetch: this.fetch,
                pickBranch: this.pickBranch,
                continueRebase: this.continueRebase,
                abortRebase: this.abortRebase,
                resolveConflict: this.resolveConflict,
                openFile: this.openFile,
                openStashDiff: this.openStashDiff,
                getBranchListData: this.getBranchListData,
                getLog: this.getLog,
                getCommitDetails: this.getCommitDetails,
                getPendingGitLogReveal: this.getPendingGitLogReveal,
                pickBranchForFilter: this.pickBranchForFilter,
                pickPaths: this.pickPaths,
                getAuthors: this.getAuthors,
                getCurrentUser: this.getCurrentUser,
                getWorkspaceState: this.getWorkspaceState,
                updateWorkspaceState: this.updateWorkspaceState,
                getUnpushedCommits: this.getUnpushedCommits,
                getWorkspaceRoot: this.getWorkspaceRoot,
                getLastCommitInfo: this.getLastCommitInfo,
                showErrorMessage: this.showErrorMessage,
                markHunkInactive: this.markHunkInactive,
                markHunkActive: this.markHunkActive,
                markFilesInactive: this.markFilesInactive,
                markFilesActive: this.markFilesActive,
                setChangelistMode: this.setChangelistMode,
                createChangelist: this.createChangelist,
                renameChangelist: this.renameChangelist,
                deleteChangelist: this.deleteChangelist,
                setActiveChangelist: this.setActiveChangelist,
                moveFilesToChangelist: this.moveFilesToChangelist,
                moveHunksToChangelist: this.moveHunksToChangelist,
                setActiveChangelistFile: this.setActiveChangelistFile,
                setChangelistTreeFocus: this.setChangelistTreeFocus
            }
        )
    }

    getPendingGitLogReveal = async (): Promise<GitLogRevealRequest | undefined> => {
        return this.consumePendingGitLogReveal?.();
    };


    push = async (params: { force: boolean; pushTags: boolean; noVerify?: boolean; remote: string; branch: string }): Promise<void> => {
        const branches = await this.gitService.getBranches();
        const currentBranch = branches.current;

        // Check if upstream was set before push
        const hadUpstream = await this.gitService.getUpstreamBranch();

        const pushOptions = {
            noVerify: params.noVerify
        };

        try {
            if (params.force) {
                await this.gitService.forcePush(params.remote, `${currentBranch}:${params.branch}`, pushOptions);
            } else {
                await this.gitService.push(params.remote, `${currentBranch}:${params.branch}`, pushOptions);
            }

            // Auto-set upstream if not previously set and pushing to same-named branch
            if (!hadUpstream && params.branch === currentBranch) {
                try {
                    await this.gitService.setUpstreamBranch(params.remote, params.branch);
                } catch (e) {
                    logger.error('Failed to set upstream:', e);
                }
            }

            if (params.pushTags) {
                await this.gitService.pushTags(params.remote);
            }
        } catch (error) {
            if (!params.force && this.isBehindPushError(error)) {
                try {
                    await this.gitService.fetch();
                } catch (fetchError) {
                    logger.warn('Fetch after push rejection failed:', fetchError);
                }

                const branchStatus = await this.gitService.getBranchStatus();
                throw new Error(`PUSH_REJECTED_BEHIND:${branchStatus.behind || 1}`, { cause: error });
            }

            throw error;
        }
    };

    private async getStatusWithState(): Promise<FileStatus[]> {
        const gitService = this.repositoryManager.getActiveService();
        if (!gitService) {
            return [];
        }

        const status = await gitService.getStatus();
        this.inactiveChangesService?.syncWithStatus(status);
        this.changelistStateService?.syncWithStatus(status);

        return this.decorateStatus(status);
    };

    getStatus = async (): Promise<FileStatus[]> => {
        return this.getStatusWithState();
    };

    getChangelistState = async () => {
        const gitService = this.repositoryManager.getActiveService();
        if (!gitService) {
            return this.getCurrentChangelistState();
        }

        const status = await gitService.getStatus();
        this.changelistStateService?.syncWithStatus(status);
        return this.getCurrentChangelistState();
    };

    getCommitViewState = async () => {
        const startedAt = Date.now();
        const gitService = this.repositoryManager.getActiveService();
        if (!gitService) {
            return {
                files: [],
                changelistState: this.getCurrentChangelistState(),
                workspaceRoot: '',
                hasRepository: false
            };
        }

        const status = await gitService.getStatus();
        this.inactiveChangesService?.syncWithStatus(status);
        this.changelistStateService?.syncWithStatus(status);
        const files = this.decorateStatus(status);
        const changelistState = this.getCurrentChangelistState();
        const elapsedMs = Date.now() - startedAt;

        logger.info('[refresh] commit view state loaded', {
            elapsedMs,
            files: files.length,
            hunkFiles: files.filter(file => file.hunks && file.hunks.length > 0).length,
            mode: changelistState.mode
        });

        return {
            files,
            changelistState,
            workspaceRoot: gitService.getWorkspaceRoot(),
            hasRepository: true
        };
    };

    private getCurrentChangelistState(): ChangelistState {
        return this.changelistStateService?.getState() || {
            mode: 'staged',
            activeListId: 'changes',
            lists: [{ id: 'changes', name: 'Changes', isDefault: true, isActive: true }],
            assignments: {}
        };
    }

    private decorateStatus(status: FileStatus[]): FileStatus[] {
        return status.map(file => {
            const isFileInactive = !!this.inactiveChangesService?.isInactive(file.path);
            const inactiveHunkIds = this.inactiveChangesService?.getInactiveHunkIds(file.path) || [];
            const inactiveHunkIdSet = new Set(inactiveHunkIds);
            const hasStagedInactive = file.staged && (
                isFileInactive ||
                file.hunks?.some(hunk =>
                    inactiveHunkIdSet.has(hunk.id) ||
                    inactiveHunkIdSet.has(hunk.id.replace(':index:', ':worktree:')) ||
                    inactiveHunkIdSet.has(hunk.id.replace(':worktree:', ':index:'))
                )
            );

            return {
                ...file,
                inactive: isFileInactive,
                inactiveHunkIds,
                hasStagedInactive
            };
        });
    }

    openDiff = async (filePathOrArgs: string | [string, boolean?], staged?: boolean): Promise<void> => {
        const [filePath, effectiveStaged] = Array.isArray(filePathOrArgs)
            ? [filePathOrArgs[0], filePathOrArgs[1]]
            : [filePathOrArgs, staged];

        if (effectiveStaged) {
            // HEAD vs Index
            const leftUri = createRevisionContentUri(this.gitService, filePath, { ref: 'HEAD', preferStaged: true });
            const rightUri = createRevisionContentUri(this.gitService, filePath, { ref: '' });
            const title = `${path.basename(filePath)} ${i18n.t('(Staged)')}`;
            await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
        } else {
            const status = await this.gitService.getStatus();
            const target = status.find(file => file.path === filePath && !file.staged) || status.find(file => file.path === filePath);
            if (target?.status === 'D') {
                const leftUri = createRevisionContentUri(this.gitService, filePath, { ref: 'HEAD', preferStaged: false });
                const rightUri = createRevisionContentUri(this.gitService, filePath, { ref: 'WORKTREE', preferStaged: false });
                await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, path.basename(filePath));
                return;
            }

            const workspaceRoot = this.gitService.getWorkspaceRoot();
            const uri = vscode.Uri.file(`${workspaceRoot}/${filePath}`);
            await vscode.commands.executeCommand('git.openChange', uri);
        }
    };

    setActiveChangelistFile = async (selection: ChangelistFileSelection | null): Promise<void> => {
        this.onChangelistSelectionChange?.(selection);
    };

    setChangelistTreeFocus = async (focused: boolean): Promise<void> => {
        this.onChangelistFocusChange?.(focused);
    };

    closeWebView = async (): Promise<void> => {
        this.onDispose();
    };

    openCommitDiff = async (params: { path: string; leftRef: string; rightRef: string; preserveFocus?: boolean }): Promise<void> => {
        const leftUri = createRevisionContentUri(this.gitService, params.path, { ref: params.leftRef, pathKind: 'repo' });
        const rightUri = createRevisionContentUri(this.gitService, params.path, { ref: params.rightRef, pathKind: 'repo' });
        const title = `${path.basename(params.path)} (${params.leftRef.substring(0, 7)} ↔ ${params.rightRef.substring(0, 7)})`;
        vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title, {
            preserveFocus: params.preserveFocus ?? false
        });
    };

    pickPaths = async (): Promise<string[] | undefined> => {
        const workspaceRoot = this.repositoryManager.getActiveService()?.getWorkspaceRoot();
        if (!workspaceRoot) {
            vscode.window.showWarningMessage(i18n.t('extension.noRoot'));
            return undefined;
        }

        const result = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: true,
            canSelectMany: true,
            openLabel: i18n.t('extension.selectPath'),
            defaultUri: vscode.Uri.file(workspaceRoot)
        });

        if (!result || result.length === 0) {
            return undefined;
        }

        const validPaths: string[] = [];
        const invalidPaths: string[] = [];

        for (const uri of result) {
            if (uri.fsPath.startsWith(workspaceRoot)) {
                let relativePath = uri.fsPath.substring(workspaceRoot.length);
                if (relativePath.startsWith('/') || relativePath.startsWith('\\')) {
                    relativePath = relativePath.substring(1);
                }
                if (relativePath === '') {
                    relativePath = '.';
                }
                validPaths.push(relativePath);
            } else {
                invalidPaths.push(uri.fsPath);
            }
        }

        if (invalidPaths.length > 0) {
            const msg = invalidPaths.length === 1
                ? i18n.t('extension.pathNotInWorkspace', invalidPaths[0])
                : i18n.t('extension.pathsNotInWorkspace', invalidPaths.length);
            vscode.window.showWarningMessage(msg);
        }

        if (validPaths.length === 0) {
            return undefined;
        }

        return validPaths;
    };

    pickBranchForFilter = async (): Promise<string | undefined> => {
        const gitService = this.repositoryManager.getActiveService();
        if (!gitService) {
            return undefined;
        }

        const branchData = await gitService.getBranchListData();

        interface BranchQuickPickItem extends vscode.QuickPickItem {
            branch: string;
        }

        const items: BranchQuickPickItem[] = [];
        const addedBranches = new Set<string>();

        const addBranch = (branch: string, icon: string, description?: string) => {
            if (addedBranches.has(branch)) return;
            addedBranches.add(branch);
            items.push({
                label: `${icon} ${branch}`,
                description,
                branch
            });
        };

        items.push({
            label: `$(git-branch) ${i18n.t('extension.all')}`,
            branch: 'all',
            kind: vscode.QuickPickItemKind.Default
        });
        addedBranches.add('all');

        items.push({
            label: i18n.t('extension.common'),
            kind: vscode.QuickPickItemKind.Separator,
            branch: ''
        });

        addBranch('HEAD', '$(symbol-reference)', i18n.t('extension.currentHead'));

        if (branchData.currentBranch) {
            addBranch(branchData.currentBranch, '$(git-branch)', i18n.t('extension.currentBranch'));
        }

        const priorityBranches = ['main', 'master'];
        for (const pb of priorityBranches) {
            if (branchData.localBranches.includes(pb)) {
                addBranch(pb, '$(git-branch)');
            }
            for (const remote of Object.keys(branchData.remoteBranches)) {
                if (branchData.remoteBranches[remote].includes(pb)) {
                    addBranch(`${remote}/${pb}`, '$(cloud)');
                }
            }
        }

        items.push({
            label: i18n.t('extension.localBranches'),
            kind: vscode.QuickPickItemKind.Separator,
            branch: ''
        });

        for (const branch of branchData.localBranches) {
            addBranch(branch, '$(git-branch)');
        }

        for (const [remote, branches] of Object.entries(branchData.remoteBranches)) {
            items.push({
                label: remote,
                kind: vscode.QuickPickItemKind.Separator,
                branch: ''
            });

            for (const branch of branches) {
                addBranch(`${remote}/${branch}`, '$(cloud)');
            }
        }

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: i18n.t('extension.selectBranchFilter'),
            matchOnDescription: true,
            canPickMany: true
        });

        if (!selected || selected.length === 0) {
            return undefined;
        }

        const branches = selected.map(s => s.branch).filter(b => b);
        return branches.length === 1 ? branches[0] : branches.join(',');
    };

    commit = async (params: { message: string; amend: boolean; files: string[]; push?: boolean }): Promise<void> => {
        try {
            const changelistState = this.changelistStateService?.getState();

            if (changelistState?.mode === 'changes') {
                const status = await this.getStatusWithState();
                const plan = this.changelistStateService?.buildCommitPlan(status, params.files);

                if (!plan || (!params.amend && plan.files.length === 0)) {
                    throw new Error('No active changelist changes to commit');
                }

                if (params.amend && plan.files.length === 0) {
                    await this.gitService.commitAmend(params.message, []);
                } else {
                    await this.gitService.commitChangelistPlan(params.message, params.amend, plan, status);
                }
            } else if (params.amend) {
                await this.gitService.commitAmend(params.message, undefined);
            } else {
                await this.gitService.commit(params.message, undefined);
            }

            if (params.push) {
                const branches = await this.gitService.getBranches();
                if (branches.current) {
                    await this.gitService.push('origin', branches.current);
                }
            }
        } catch (e) {
            throw e;
        }
    };

    stage = async (filePath: string): Promise<void> => {
        await this.gitService.stageFile(filePath);
    };

    stageFiles = async (filePaths: string[]): Promise<void> => {
        await this.gitService.stageFiles(filePaths);
    };

    unstage = async (filePath: string): Promise<void> => {
        await this.gitService.unstageFile(filePath);
    };

    unstageFiles = async (filePaths: string[]): Promise<void> => {
        await this.gitService.unstageFiles(filePaths);
    };

    stageAll = async (): Promise<void> => {
        await this.gitService.stageAll();
    };

    unstageAll = async (): Promise<void> => {
        await this.gitService.unstageAll();
    };

    stageTracked = async (): Promise<void> => {
        await this.gitService.stageTracked();
    };

    stash = async (params: { message?: string; files: string[]; stagedOnly?: boolean }): Promise<void> => {
        try {
            let message = params.message;
            if (!message) {
                message = await vscode.window.showInputBox({
                    placeHolder: i18n.t('extension.stashPlaceholder')
                });
            }
            await this.gitService.stash(message, params.files, false, params.stagedOnly);
            vscode.window.showInformationMessage(i18n.t('extension.stashSuccess'));
        } catch (e) {
            vscode.window.showErrorMessage(i18n.t('extension.stashFailed', `${e}`));
        }
    };

    deleteFiles = async (files: string[]): Promise<void> => {
        const answer = await vscode.window.showWarningMessage(
            i18n.t('extension.deleteFilesConfirm', files.length),
            { modal: true },
            i18n.t('Delete')
        );
        if (answer === i18n.t('Delete')) {
            const workspaceRoot = this.gitService.getWorkspaceRoot();
            if (!workspaceRoot) return;
            try {
                for (const file of files) {
                    const uri = vscode.Uri.file(`${workspaceRoot}/${file}`);
                    await vscode.workspace.fs.delete(uri, { recursive: false, useTrash: true });
                }

            } catch (e) {
                vscode.window.showErrorMessage(i18n.t('extension.deleteFailed', `${e}`));
            }
        }
    };

    rollback = async (files: string[]): Promise<void> => {
        const answer = await vscode.window.showWarningMessage(
            i18n.t('extension.rollbackFilesConfirm', files.length),
            { modal: true },
            i18n.t('Rollback')
        );
        if (answer === i18n.t('Rollback')) {
            try {
                await this.gitService.rollbackFiles(files);

            } catch (e) {
                vscode.window.showErrorMessage(i18n.t('extension.rollbackFailed', `${e}`));
            }
        }
    };

    openFile = async (params: { path: string; preserveFocus?: boolean }): Promise<void> => {
        const workspaceRoot = this.gitService.getWorkspaceRoot();
        if (!workspaceRoot) return;
        const uri = vscode.Uri.file(`${workspaceRoot}/${params.path}`);
        try {
            await vscode.workspace.fs.stat(uri);
            await vscode.commands.executeCommand('vscode.open', uri, {
                preserveFocus: params.preserveFocus ?? false
            });
        } catch {
            const status = await this.gitService.getStatus();
            const deleted = status.some(file => file.path === params.path && file.status === 'D');
            if (deleted) {
                await this.openDiff(params.path, status.find(file => file.path === params.path && file.status === 'D')?.staged);
            }
        }
    };

    openStashDiff = async (params: { index: number; path: string }): Promise<void> => {
        const stashRef = `stash@{${params.index}}`;
        const parentRef = `${stashRef}^`;
        const filePath = params.path;

        const leftUri = createStashContentUri(this.gitService, parentRef, filePath);
        const rightUri = createStashContentUri(this.gitService, stashRef, filePath);

        const title = `${path.basename(filePath)} (Stash@{${params.index}})`;
        await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title, {
            preview: true,
            viewColumn: vscode.ViewColumn.Active
        });
    };

    switchBranch = async (branch: string): Promise<void> => {
        try {
            await this.gitService.switchBranch(branch);

        } catch (e) {
            vscode.window.showErrorMessage(i18n.t('extension.switchBranchFailed', `${e}`));
        }
    };

    pull = async (): Promise<void> => {
        try {
            await this.gitService.pull();
            vscode.window.showInformationMessage(i18n.t('extension.pullSuccess'));
        } catch (e) {
            vscode.window.showErrorMessage(i18n.t('extension.pullFailed', `${e}`));
            throw e;
        }
    };

    fetch = async (): Promise<void> => {
        try {
            await this.gitService.fetch();
        } catch (e) {
            logger.error('Fetch failed:', e);
            throw e;
        }
    };

    showErrorMessage = async (message: string): Promise<void> => {
        vscode.window.showErrorMessage(message);
    };

    markHunkInactive = async (params: { path: string; hunkId: string }): Promise<void> => {
        await this.inactiveChangesService?.markHunkInactive(params.path, params.hunkId);
    };

    markHunkActive = async (params: { path: string; hunkId: string }): Promise<void> => {
        await this.inactiveChangesService?.markHunkActive(params.path, params.hunkId);
    };

    markFilesInactive = async (paths: string[]): Promise<void> => {
        if (!this.inactiveChangesService || paths.length === 0) return;
        await this.inactiveChangesService.markInactive(paths);

        const status = await this.gitService.getStatus();
        const stagedPaths = Array.from(new Set(
            status
                .filter(file => paths.includes(file.path) && file.staged)
                .map(file => file.path)
        ));
        if (stagedPaths.length > 0) {
            await this.gitService.unstageFiles(stagedPaths);
        }
    };

    markFilesActive = async (paths: string[]): Promise<void> => {
        if (!this.inactiveChangesService || paths.length === 0) return;
        await this.inactiveChangesService.markActive(paths);
    };

    setChangelistMode = async (mode: 'staged' | 'changes'): Promise<void> => {
        await this.changelistStateService?.setMode(mode);
    };

    createChangelist = async (name?: string) => {
        const changelistName = (name || await vscode.window.showInputBox({
            prompt: i18n.t('extension.enterChangelistName'),
            value: i18n.t('Changes')
        }))?.trim();

        if (!changelistName) {
            return null;
        }

        return this.changelistStateService?.createList(changelistName) || null;
    };

    renameChangelist = async (params: { id: string; name?: string }) => {
        const current = this.changelistStateService?.getState().lists.find(list => list.id === params.id);
        if (!current) {
            return null;
        }

        const changelistName = (params.name || await vscode.window.showInputBox({
            prompt: i18n.t('extension.enterChangelistName'),
            value: current.name
        }))?.trim();

        if (!changelistName) {
            return null;
        }

        return this.changelistStateService?.renameList(params.id, changelistName) || null;
    };

    deleteChangelist = async (id: string): Promise<void> => {
        const target = this.changelistStateService?.getState().lists.find(list => list.id === id);
        if (!target) {
            return;
        }

        const itemCount = this.changelistStateService?.getListItemCount(id) || 0;
        if (itemCount > 0) {
            const confirmed = await vscode.window.showWarningMessage(
                i18n.t('extension.changelistNotEmpty', target.name),
                { modal: true },
                i18n.t('Delete')
            );

            if (confirmed !== i18n.t('Delete')) {
                return;
            }
        }

        await this.changelistStateService?.deleteList(id);
    };

    setActiveChangelist = async (id: string): Promise<void> => {
        await this.changelistStateService?.setActiveList(id);
    };

    moveFilesToChangelist = async (params: { paths: string[]; targetListId: string }): Promise<void> => {
        await this.changelistStateService?.moveFiles(params.paths, params.targetListId);
        await vscode.commands.executeCommand('intelli-git.refreshChangeBlockDecorations');
    };

    moveHunksToChangelist = async (params: { path: string; hunkIds: string[]; targetListId: string }): Promise<void> => {
        await this.changelistStateService?.moveHunks(params.path, params.hunkIds, params.targetListId);
        await vscode.commands.executeCommand('intelli-git.refreshChangeBlockDecorations');
    };

    pickBranch = async (): Promise<void> => {
        await vscode.commands.executeCommand('intelli-git.showBranchPicker');
    };

    continueRebase = async (params: { message?: string; files?: string[] }): Promise<void> => {
        try {
            const currentStatus = await this.getStatus();
            const unresolvedFiles = currentStatus.filter(
                file => (file.status === 'C' || file.status === 'U') && !file.resolvedCandidate
            );

            if (unresolvedFiles.length > 0) {
                vscode.window.showErrorMessage(i18n.t('extension.resolveConflictsBeforeContinue'));
                return;
            }

            const filesToStage = new Set<string>(params.files || []);

            // During merge/rebase continue, once no unmerged entries remain,
            // auto-stage tracked unresolved->resolved files so Git can continue.
            currentStatus
                .filter(file => !file.inactive && !file.staged && file.status !== '?')
                .forEach(file => filesToStage.add(file.path));

            for (const file of filesToStage) {
                await this.gitService.stageFile(file);
            }

            await this.gitService.continueRebase(params.message);
            vscode.window.showInformationMessage(i18n.t('extension.rebaseContinued'));

        } catch (e) {
            const errorMessage = `${e}`;
            if (
                errorMessage.includes('No changes - did you forget to use') ||
                errorMessage.includes('mark them as resolved using git add') ||
                errorMessage.includes('You must edit all merge conflicts')
            ) {
                vscode.window.showErrorMessage(i18n.t('extension.stageResolvedFilesBeforeContinue'));
                return;
            }

            vscode.window.showErrorMessage(i18n.t('extension.continueRebaseFailed', errorMessage));
        }
    };

    abortRebase = async (): Promise<void> => {
        try {
            await this.gitService.abortRebase();
            vscode.window.showInformationMessage(i18n.t('extension.rebaseAborted'));

        } catch (e) {
            vscode.window.showErrorMessage(i18n.t('extension.abortRebaseFailed', `${e}`));
        }
    };

    resolveConflict = async (params: { path: string; side: 'ours' | 'theirs' }): Promise<void> => {
        try {
            await this.gitService.resolveConflict(params.path, params.side);
        } catch (e) {
            vscode.window.showErrorMessage(i18n.t('extension.resolveConflictFailed', `${e}`));
        }
    };

    generateCommitMessage = async (files?: string[]): Promise<string> => {
        try {
            let diff = '';
            const changelistState = this.changelistStateService?.getState();

            if (changelistState?.mode === 'changes') {
                const status = await this.getStatusWithState();
                const plan = this.changelistStateService?.buildCommitPlan(status, files);
                diff = plan ? await this.gitService.getDiffForChangelistPlan(plan, status) : '';
            } else if (files && files.length > 0) {
                diff = await this.gitService.getDiffForFiles(files);
            } else {
                diff = await this.gitService.getStagedDiff();
            }

            if (!diff) {
                return '';
            }

            const model = await this.getAIModel();
            const commitPrompt = vscode.workspace
                .getConfiguration('intelli-git.ai')
                .get<string>('commitPrompt', DEFAULT_COMMIT_MESSAGE_PROMPT)
                .trim() || DEFAULT_COMMIT_MESSAGE_PROMPT;

            const messages = [
                vscode.LanguageModelChatMessage.User(commitPrompt),
                vscode.LanguageModelChatMessage.User(diff)
            ];

            logger.debug('Generating commit message:', diff.length);
            const response = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);
            logger.debug('Generating commit message responsed');

            let fullMessage = '';
            for await (const fragment of response.text) {
                fullMessage += fragment;
            }
            logger.debug('Generated commit message:', fullMessage);
            return fullMessage.trim();
        } catch (e) {
            logger.error('Error generating commit message:', e);
            throw e;
        }
    };

    private async getAIModel(): Promise<vscode.LanguageModelChat> {
        const provider = vscode.workspace.getConfiguration('intelli-git.ai').get<string>('provider', AiProvider.Copilot);

        if (provider === AiProvider.Anthropic) {
            const apiKey = await getAiApiKey(this.context, 'anthropic');
            const model = new AnthropicService().getModel(apiKey);
            if (!model) {
                throw new Error(apiKey ? i18n.t('extension.anthropicApiUrlMissing') : i18n.t('extension.anthropicApiKeyMissing'));
            }
            return model;
        }

        if (provider === AiProvider.Google) {
            const apiKey = await getAiApiKey(this.context, 'google');
            const model = new GoogleAiService().getModel(apiKey);
            if (!model) {
                throw new Error(i18n.t('extension.googleApiKeyMissing'));
            }
            return model;
        }

        if (provider === AiProvider.OpenAi) {
            const apiKey = await getAiApiKey(this.context, 'custom');
            const model = new OpenAiService().getModel(apiKey);
            if (!model) {
                throw new Error(i18n.t('extension.noAIModel')); // generic error or specific custom one if added
            }
            return model;
        }

        // Default: use Copilot
        const preferredCopilotModel = this.normalizeModelIdentifier(
            vscode.workspace.getConfiguration('intelli-git.ai.copilot').get<string>('model', 'gpt-5-mini')
        );

        const copilotModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
        let model = copilotModels.find(candidate => {
            const identifiers = [
                this.normalizeModelIdentifier(candidate.id),
                this.normalizeModelIdentifier(candidate.name),
                this.normalizeModelIdentifier(candidate.family)
            ];

            return identifiers.includes(preferredCopilotModel);
        });

        if (!model && copilotModels.length > 0) {
            throw new Error(`The configured GitHub Copilot model "${preferredCopilotModel}" is not currently available. Please select an available model in Intelli Git settings or run "Intelli: Select Copilot Model".`);
        }

        if (!model) {
            throw new Error('No GitHub Copilot model is currently available. Please ensure GitHub Copilot Chat is installed and enabled.');
        }

        logger.info('Using copilot AI model:', model.id, model.name, model.vendor);

        return model;
    }

    getWorkspaceState = async <T>(key: string): Promise<T | undefined> => {
        return this.context.workspaceState.get<T>(key);
    };

    updateWorkspaceState = async <T>(key: string, value: T): Promise<void> => {
        await this.context.workspaceState.update(key, value);
    };

    getUnpushedCommits = async (): Promise<string[]> => {
        const gitService = this.repositoryManager.getActiveService();
        if (!gitService) {
            return [];
        }

        const unpushed = await gitService.getUnpushedCommits();
        return Array.from(unpushed);
    };
}
