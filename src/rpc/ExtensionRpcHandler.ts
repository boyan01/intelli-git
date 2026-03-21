import * as vscode from 'vscode';
import * as path from 'path';
import { RpcPeer } from '../../shared/rpc';
import type { WebviewMethods, ExtensionMethods, FileStatus } from '../../shared/messages';
import { GitService } from '../services/GitService';
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
    onDispose?: () => void;
}

/**
 * Full implementation of ExtensionMethods interface for RPC handling.
 * Encapsulates all Git and Changelist operations.
 */
export class ExtensionRpcHandler {
    private context: vscode.ExtensionContext;
    private gitService: GitService;
    private inactiveChangesService?: InactiveChangesService;
    private onDispose: () => void;
    private _lastRebaseStatus?: string;

    constructor(options: ExtensionRpcHandlerOptions) {
        this.context = options.context;
        this.gitService = options.gitService;
        this.inactiveChangesService = options.inactiveChangesService;
        this.onDispose = options.onDispose || (() => { });
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
                getBranchInfo: this.gitService.getRpcBranchInfo,
                getStashList: this.gitService.getStashList,
                getStashFiles: this.gitService.getStashFilesAsCommitFiles,
                commit: this.commit,
                stage: this.stage,
                stageFiles: this.stageFiles,
                unstage: this.unstage,
                stageAll: this.stageAll,
                unstageAll: this.unstageAll,
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
                showErrorMessage: this.showErrorMessage
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
    };

    getStatus = async (): Promise<FileStatus[]> => {
        const status = await this.gitService.getStatus();
        const inactiveSet = new Set(this.inactiveChangesService?.getInactiveFiles() || []);
        this.inactiveChangesService?.syncWithStatus(status.map(file => file.path));
        return status.map(file => ({
            ...file,
            inactive: inactiveSet.has(file.path)
        }));
    };

    openDiff = async (filePath: string): Promise<void> => {
        const workspaceRoot = this.gitService.getWorkspaceRoot();
        const uri = vscode.Uri.file(`${workspaceRoot}/${filePath}`);
        vscode.commands.executeCommand('git.openChange', uri);
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
            if (params.amend) {
                await this.gitService.commitAmend(params.message, params.files);
            } else {
                await this.gitService.commit(params.message, params.files);
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
        for (const path of filePaths) {
            await this.gitService.stageFile(path);
        }
    };

    unstage = async (filePath: string): Promise<void> => {
        await this.gitService.unstageFile(filePath);
    };

    stageAll = async (): Promise<void> => {
        await this.gitService.stageAll();
    };

    unstageAll = async (): Promise<void> => {
        await this.gitService.unstageAll();
    };

    stash = async (params: { message?: string; files: string[] }): Promise<void> => {
        try {
            let message = params.message;
            if (!message) {
                message = await vscode.window.showInputBox({
                    placeHolder: i18n.t('extension.stashPlaceholder')
                });
            }
            await this.gitService.stash(message, params.files);
            vscode.window.showInformationMessage(i18n.t('extension.stashSuccess'));
        } catch (e) {
            vscode.window.showErrorMessage(i18n.t('extension.stashFailed', `${e}`));
        }
    };

    deleteFiles = async (files: string[]): Promise<void> => {
        const answer = await vscode.window.showWarningMessage(
            i18n.t('extension.deleteFilesConfirm', files.length),
            { modal: true },
            'Delete'
        );
        if (answer === 'Delete') {
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
            'Rollback'
        );
        if (answer === 'Rollback') {
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
                vscode.LanguageModelChatMessage.User(i18n.t('extension.commitGenPrompt')),
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
        let [model] = await vscode.lm.selectChatModels({ vendor: 'copilot' });
        if (!model) {
            const models = await vscode.lm.selectChatModels();
            if (models.length > 0) model = models[0];
        }

        if (!model) {
            throw new Error(i18n.t('extension.noAIModel'));
        }

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
