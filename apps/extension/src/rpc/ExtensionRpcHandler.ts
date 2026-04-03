import * as vscode from 'vscode';
import * as path from 'path';
import { RpcPeer } from '@shared/rpc';
import type { WebviewMethods, ExtensionMethods, FileStatus, ChangelistFileSelection } from '@shared/messages';
import { GitService } from '../services/GitService';
import { ChangelistStateService } from '../services/ChangelistStateService';
import { InactiveChangesService } from '../services/InactiveChangesService';
import { AnthropicService } from '../services/AnthropicService';
import { GoogleAiService } from '../services/GoogleAiService';
import { OpenAiService } from '../services/CustomOpenAiService';
import { i18n } from '../utils/i18n';
import { AiProvider } from '../services/ai';
import { logger } from '../utils/logger';

export interface ExtensionRpcHandlerOptions {
    context: vscode.ExtensionContext;
    gitService: GitService;
    inactiveChangesService?: InactiveChangesService;
    changelistStateService?: ChangelistStateService;
    onDispose?: () => void;
    onChangelistSelectionChange?: (selection: ChangelistFileSelection | null) => void;
    onChangelistFocusChange?: (focused: boolean) => void;
}

/**
 * Full implementation of ExtensionMethods interface for RPC handling.
 * Encapsulates all Git and Changelist operations.
 */
export class ExtensionRpcHandler {
    private context: vscode.ExtensionContext;
    private gitService: GitService;
    private inactiveChangesService?: InactiveChangesService;
    private changelistStateService?: ChangelistStateService;
    private onDispose: () => void;
    private onChangelistSelectionChange?: (selection: ChangelistFileSelection | null) => void;
    private onChangelistFocusChange?: (focused: boolean) => void;
    private _lastRebaseStatus?: string;

    constructor(options: ExtensionRpcHandlerOptions) {
        this.context = options.context;
        this.gitService = options.gitService;
        this.inactiveChangesService = options.inactiveChangesService;
        this.changelistStateService = options.changelistStateService;
        this.onDispose = options.onDispose || (() => { });
        this.onChangelistSelectionChange = options.onChangelistSelectionChange;
        this.onChangelistFocusChange = options.onChangelistFocusChange;
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

    registerAll(rpc: RpcPeer<WebviewMethods, ExtensionMethods>) {
        rpc.registerAll(
            {
                log: this.log,
                getPushInitState: this.gitService.getPushInitState,
                getRemoteBranches: this.gitService.getRemoteBranchesForRemote,
                getPushCommits: this.gitService.getPushCommits,
                getCommitFiles: this.gitService.getCommitFiles,
                getMultiCommitFiles: this.gitService.getMultiCommitFiles,
                push: this.push,
                openDiff: this.openDiff,
                closeWebView: this.closeWebView,
                openCommitDiff: this.openCommitDiff,
                getStatus: this.getStatus,
                getChangelistState: this.getChangelistState,
                getBranchInfo: this.gitService.getRpcBranchInfo,
                getStashList: this.gitService.getStashList,
                getStashFiles: this.gitService.getStashFilesAsCommitFiles,
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
                getBranchListData: this.gitService.getBranchListData,
                getLog: this.gitService.getLog,
                getCommitDetails: this.gitService.getCommitDetails,
                pickBranchForFilter: this.pickBranchForFilter,
                pickPaths: this.pickPaths,
                getAuthors: this.gitService.getAuthors,
                getCurrentUser: this.gitService.getCurrentUser,
                getWorkspaceState: this.getWorkspaceState,
                updateWorkspaceState: this.updateWorkspaceState,
                getUnpushedCommits: this.getUnpushedCommits,
                getWorkspaceRoot: async () => this.gitService.getWorkspaceRoot(),
                getLastCommitInfo: async () => this.gitService.getLastCommitInfo(),
                showErrorMessage: this.showErrorMessage,
                markHunkInactive: this.markHunkInactive,
                markHunkActive: this.markHunkActive,
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
                throw new Error(`PUSH_REJECTED_BEHIND:${branchStatus.behind || 1}`);
            }

            throw error;
        }
    };

    getStatus = async (): Promise<FileStatus[]> => {
        const status = await this.gitService.getStatus();
        this.inactiveChangesService?.syncWithStatus(status.map(file => file.path));
        this.changelistStateService?.syncWithStatus(status);

        return status.map(file => {
            const isFileInactive = !!this.inactiveChangesService?.isInactive(file.path);
            const inactiveHunkIds = this.inactiveChangesService?.getInactiveHunkIds(file.path) || [];

            // Detection logic:
            // If the file is staged (or a staged hunk exists) AND (the file is inactive OR some staged hunks are inactive)
            const hasStagedInactive = file.staged && (isFileInactive || (file.hunks?.some(h => inactiveHunkIds.includes(h.id))));

            return {
                ...file,
                inactive: isFileInactive,
                inactiveHunkIds: inactiveHunkIds,
                hasStagedInactive: hasStagedInactive
            };
        });
    };

    getChangelistState = async () => {
        const status = await this.gitService.getStatus();
        this.changelistStateService?.syncWithStatus(status);
        return this.changelistStateService?.getState() || {
            mode: 'staged',
            activeListId: 'changes',
            lists: [{ id: 'changes', name: 'Changes', isDefault: true, isActive: true }],
            assignments: {}
        };
    };

    openDiff = async (filePath: string, staged?: boolean): Promise<void> => {
        if (staged) {
            // HEAD vs Index
            const leftUri = vscode.Uri.parse(`intelli-git-revision://load/${filePath}?${JSON.stringify({ ref: 'HEAD' })}`);
            const rightUri = vscode.Uri.parse(`intelli-git-revision://load/${filePath}?${JSON.stringify({ ref: '' })}`);
            const title = `${path.basename(filePath)} ${i18n.t('(Staged)')}`;
            await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
        } else {
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
        const leftUri = vscode.Uri.parse(`intelli-git-revision://load/${params.path}?${JSON.stringify({ ref: params.leftRef })}`);
        const rightUri = vscode.Uri.parse(`intelli-git-revision://load/${params.path}?${JSON.stringify({ ref: params.rightRef })}`);
        const title = `${path.basename(params.path)} (${params.leftRef.substring(0, 7)} ↔ ${params.rightRef.substring(0, 7)})`;
        vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title, {
            preserveFocus: params.preserveFocus ?? false
        });
    };

    pickPaths = async (): Promise<string[] | undefined> => {
        const workspaceRoot = this.gitService.getWorkspaceRoot();

        const result = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: true,
            canSelectMany: true,
            openLabel: i18n.t('extension.selectPath'),
            defaultUri: workspaceRoot ? vscode.Uri.file(workspaceRoot) : undefined
        });

        if (!result || result.length === 0) {
            return undefined;
        }

        if (!workspaceRoot) {
            vscode.window.showWarningMessage(i18n.t('extension.noRoot'));
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
        const branchData = await this.gitService.getBranchListData();

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
                const status = await this.gitService.getStatus();
                this.changelistStateService?.syncWithStatus(status);
                const plan = this.changelistStateService?.buildCommitPlan(status);

                if (!plan || plan.files.length === 0) {
                    throw new Error('No active changelist changes to commit');
                }

                await this.gitService.stageFiles(plan.files);

                for (const excludedFile of plan.excludedFiles) {
                    await this.gitService.unstageFile(excludedFile);
                }

                for (const [filePath, hunkIds] of Object.entries(plan.excludedHunkIdsByPath)) {
                    if (hunkIds.length === 0) {
                        continue;
                    }

                    const hunks = status
                        .filter(file => file.path === filePath)
                        .flatMap(file => file.hunks || [])
                        .filter(hunk => hunkIds.includes(hunk.id));

                    if (hunks.length > 0) {
                        await this.gitService.applyPatch(this.gitService.buildPatchFromHunks(hunks), true, true);
                    }
                }
            }

            if (params.amend) {
                await this.gitService.commitAmend(params.message, changelistState?.mode === 'changes' ? undefined : params.files);
            } else {
                await this.gitService.commit(params.message, changelistState?.mode === 'changes' ? undefined : params.files);
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
            // File doesn't exist, possibly deleted
        }
    };

    openStashDiff = async (params: { index: number; path: string }): Promise<void> => {
        const stashRef = `stash@{${params.index}}`;
        const parentRef = `${stashRef}^`;
        const filePath = params.path;

        const leftUri = vscode.Uri.parse(`intelli-git-stash://stash/${encodeURIComponent(parentRef)}/${filePath}`).with({
            query: JSON.stringify({ ref: parentRef, path: filePath })
        });
        const rightUri = vscode.Uri.parse(`intelli-git-stash://stash/${encodeURIComponent(stashRef)}/${filePath}`).with({
            query: JSON.stringify({ ref: stashRef, path: filePath })
        });

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
        } catch (e) {
            vscode.window.showErrorMessage(i18n.t('extension.pullFailed', `${e}`));
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
    };

    moveHunksToChangelist = async (params: { path: string; hunkIds: string[]; targetListId: string }): Promise<void> => {
        await this.changelistStateService?.moveHunks(params.path, params.hunkIds, params.targetListId);
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
            if (files && files.length > 0) {
                diff = await this.gitService.getDiffForFiles(files);
            } else {
                diff = await this.gitService.getStagedDiff();
            }

            if (!diff) {
                return '';
            }

            const model = await this.getAIModel();

            const messages = [
                vscode.LanguageModelChatMessage.User(
                    'Generate a concise commit message based on the following diff. Use the conventional commits format (e.g. feat: ..., fix: ...). Only return the commit message, no explanation, no code blocks.'
                ),
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
            const model = new AnthropicService().getModel();
            if (!model) {
                throw new Error(i18n.t('extension.anthropicApiUrlMissing'));
            }
            return model;
        }

        if (provider === AiProvider.Google) {
            const model = new GoogleAiService().getModel();
            if (!model) {
                throw new Error(i18n.t('extension.googleApiKeyMissing'));
            }
            return model;
        }

        if (provider === AiProvider.OpenAi) {
            const model = new OpenAiService().getModel();
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
        const unpushed = await this.gitService.getUnpushedCommits();
        return Array.from(unpushed);
    };
}
