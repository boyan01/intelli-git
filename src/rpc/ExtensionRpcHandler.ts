import * as vscode from 'vscode';
import * as path from 'path';
import { RpcPeer } from '../../shared/rpc';
import type { WebviewMethods, ExtensionMethods, CommitFile, CommitState, PushCommitsData, PushInitState, ChangelistGroup, BranchInfo, StashItem, BranchListData, LogCommit, LogOptions, CommitDetails } from '../../shared/messages';
import { GitService } from '../services/GitService';
import { ChangelistService } from '../services/ChangelistService';
import { i18n } from '../utils/i18n';

export interface ExtensionRpcHandlerOptions {
    context: vscode.ExtensionContext;
    gitService: GitService;
    changelistService?: ChangelistService;
    onDispose?: () => void;
}

/**
 * Full implementation of ExtensionMethods interface for RPC handling.
 * Encapsulates all Git and Changelist operations.
 */
export class ExtensionRpcHandler {
    private context: vscode.ExtensionContext;
    private gitService: GitService;
    private changelistService?: ChangelistService;
    private onDispose: () => void;
    private _lastRebaseStatus?: string;

    constructor(options: ExtensionRpcHandlerOptions) {
        this.context = options.context;
        this.gitService = options.gitService;
        this.changelistService = options.changelistService;
        this.onDispose = options.onDispose || (() => { });
    }

    log = (message: string): Promise<void> => {
        console.log(message);
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
                getStatus: this.gitService.getStatus,
                getBranchInfo: this.gitService.getRpcBranchInfo,
                getStashList: this.gitService.getStashList,
                getStashFiles: this.gitService.getStashFilesAsCommitFiles,
                commit: this.commit,
                stage: this.stage,
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
                createChangelist: this.createChangelist,
                pickBranch: this.pickBranch,
                continueRebase: this.continueRebase,
                abortRebase: this.abortRebase,
                moveFiles: this.moveFiles,
                deleteChangelist: this.deleteChangelist,
                renameChangelist: this.renameChangelist,
                promptCreateChangelist: this.promptCreateChangelist,
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
                updateWorkspaceState: this.updateWorkspaceState
            }
        )
    }


    push = async (params: { force: boolean; pushTags: boolean; remote: string; branch: string }): Promise<void> => {
        const branches = await this.gitService.getBranches();
        const currentBranch = branches.current;

        if (params.force) {
            await this.gitService.forcePush(params.remote, `${currentBranch}:${params.branch}`);
        } else {
            await this.gitService.push(params.remote, `${currentBranch}:${params.branch}`);
        }

        if (params.pushTags) {
            await this.gitService.pushTags(params.remote);
        }

        vscode.window.showInformationMessage(
            i18n.t('extension.pushSuccess', params.remote, params.branch)
        );
    };

    openDiff = async (filePath: string): Promise<void> => {
        const workspaceRoot = this.gitService.getWorkspaceRoot();
        const uri = vscode.Uri.file(`${workspaceRoot}/${filePath}`);
        vscode.commands.executeCommand('git.openChange', uri);
    };

    closeWebView = async (): Promise<void> => {
        this.onDispose();
    };

    openCommitDiff = async (params: { path: string; leftRef: string; rightRef: string }): Promise<void> => {
        const leftUri = vscode.Uri.parse(`intelli-git-revision://load/${params.path}?${JSON.stringify({ ref: params.leftRef })}`);
        const rightUri = vscode.Uri.parse(`intelli-git-revision://load/${params.path}?${JSON.stringify({ ref: params.rightRef })}`);
        const title = `${path.basename(params.path)} (${params.leftRef.substring(0, 7)} ↔ ${params.rightRef.substring(0, 7)})`;
        vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
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
                    vscode.window.showInformationMessage(i18n.t('extension.pushSuccess', 'origin', branches.current));
                }
            } else {
                vscode.window.showInformationMessage(i18n.t('extension.commitSuccess'));
            }

        } catch (e) {
            vscode.window.showErrorMessage(i18n.t('extension.commitFailed', `${e}`));
            throw e;
        }
    };

    stage = async (filePath: string): Promise<void> => {
        await this.gitService.stageFile(filePath);
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
            vscode.window.showInformationMessage(i18n.t('extension.pullSuccess'));

        } catch (e) {
            vscode.window.showErrorMessage(i18n.t('extension.pullFailed', `${e}`));
        }
    };

    fetch = async (): Promise<void> => {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: i18n.t('extension.fetching'),
            cancellable: true
        }, async (progress, token) => {
            try {
                await this.gitService.fetch();
                if (!token.isCancellationRequested) {
                    vscode.window.showInformationMessage(i18n.t('extension.fetchSuccess'));
                }
            } catch (e) {
                if (!token.isCancellationRequested) {
                    vscode.window.showErrorMessage(i18n.t('extension.fetchFailed', `${e}`));
                }
            } finally {

            }
        });
    };

    pickBranch = async (): Promise<void> => {
        await vscode.commands.executeCommand('intelli-git.showBranchPicker');
    };

    continueRebase = async (params: { message?: string; files?: string[] }): Promise<void> => {
        try {
            await this.gitService.continueRebase(params.message);
            vscode.window.showInformationMessage(i18n.t('extension.rebaseContinued'));

        } catch (e) {
            vscode.window.showErrorMessage(i18n.t('extension.continueRebaseFailed', `${e}`));
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

    createChangelist = async (name: string): Promise<void> => {
        await this.changelistService?.createChangelist(name);

    };

    moveFiles = async (params: { files: string[]; targetListId: string }): Promise<void> => {
        await this.changelistService?.moveFiles(params.files, params.targetListId);

    };

    deleteChangelist = async (id: string): Promise<void> => {
        const list = this.changelistService?.getChangelistById(id);
        if (list && list.files.length > 0) {
            const answer = await vscode.window.showWarningMessage(
                i18n.t('extension.changelistNotEmpty', list.name),
                { modal: true },
                'Delete'
            );
            if (answer === 'Delete') {
                await this.changelistService?.removeChangelist(id);

            }
        } else {
            await this.changelistService?.removeChangelist(id);

        }
    };

    renameChangelist = async (params: { id: string; name: string }): Promise<void> => {
        await this.changelistService?.renameChangelist(params.id, params.name);

    };

    promptCreateChangelist = async (file?: string): Promise<void> => {
        const newName = await vscode.window.showInputBox({
            prompt: i18n.t('extension.enterChangelistName'),
            placeHolder: i18n.t('extension.newChangelistPlaceholder')
        });
        if (newName) {
            const newId = await this.changelistService?.createChangelist(newName);
            if (file && newId) {
                await this.changelistService?.moveFiles([file], newId);
            }

        }
    };

    generateCommitMessage = async (files?: string[]): Promise<string> => {
        if (!this.gitService) return '';

        try {
            let diff = '';
            if (files && files.length > 0) {
                diff = await this.gitService.getDiffForFiles(files);
            } else {
                diff = await this.gitService.getStagedDiff();
            }

            if (!diff) {
                const message = files && files.length > 0
                    ? i18n.t('extension.noChangesForCommitGen')
                    : i18n.t('extension.noStagedChangesForCommitGen');
                vscode.window.showInformationMessage(message);
                return '';
            }

            let [model] = await vscode.lm.selectChatModels({ vendor: 'copilot' });
            if (!model) {
                const models = await vscode.lm.selectChatModels();
                if (models.length > 0) model = models[0];
            }

            if (!model) {
                throw new Error(i18n.t('extension.noAIModel'));
            }

            const messages = [
                vscode.LanguageModelChatMessage.User(i18n.t('extension.commitGenPrompt')),
                vscode.LanguageModelChatMessage.User(diff)
            ];

            const response = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);
            let fullMessage = '';

            for await (const fragment of response.text) {
                fullMessage += fragment;
            }
            return fullMessage.trim();
        } catch (e) {
            console.error('Error generating commit message:', e);
            vscode.window.showErrorMessage(i18n.t('extension.commitGenFailed', `${e}`));
            throw e;
        }
    };

    getWorkspaceState = async <T>(key: string): Promise<T | undefined> => {
        return this.context.workspaceState.get<T>(key);
    };

    updateWorkspaceState = async <T>(key: string, value: T): Promise<void> => {
        await this.context.workspaceState.update(key, value);
    };
}
