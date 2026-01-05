import * as vscode from 'vscode';
import * as path from 'path';
import { RpcPeer } from '../../shared/rpc';
import type { WebviewMethods, ExtensionMethods, CommitFile, CommitState, PushCommitsData, PushInitState, ChangelistGroup, BranchInfo, StashItem, BranchListData, LogCommit, LogOptions, CommitDetails } from '../../shared/messages';
import { GitService } from '../services/GitService';
import { ChangelistService } from '../services/ChangelistService';
import { i18n } from '../utils/i18n';

export interface ExtensionRpcHandlerOptions {
    gitService: GitService;
    changelistService?: ChangelistService;
    onDispose?: () => void;
}

/**
 * Full implementation of ExtensionMethods interface for RPC handling.
 * Encapsulates all Git and Changelist operations.
 */
export class ExtensionRpcHandler implements ExtensionMethods {
    private gitService: GitService;
    private changelistService?: ChangelistService;
    private onDispose: () => void;
    private _lastRebaseStatus?: string;

    constructor(options: ExtensionRpcHandlerOptions) {
        this.gitService = options.gitService;
        this.changelistService = options.changelistService;
        this.onDispose = options.onDispose || (() => { });
    }

    log(message: string): Promise<void> {
        console.log(message);
        return Promise.resolve();
    }

    registerAll(rpc: RpcPeer<WebviewMethods, ExtensionMethods>) {
        rpc.registerAll(this);
    }

    async getPushInitState(): Promise<PushInitState> {
        const branches = await this.gitService.getBranches();
        const remotes = await this.gitService.getRemotes();
        return {
            localBranch: branches.current,
            remotes: remotes.length > 0 ? remotes : ['origin']
        };
    }

    async getRemoteBranches(remote: string): Promise<string[]> {
        const allRemoteBranches = await this.gitService.getRemoteBranches();
        const prefix = `${remote}/`;
        return allRemoteBranches
            .filter(b => b.startsWith(prefix) && !b.includes('HEAD'))
            .map(b => b.substring(prefix.length));
    }

    async getPushCommits(params: { remote: string; branch: string }): Promise<PushCommitsData> {
        const branches = await this.gitService.getBranches();
        const currentBranch = branches.current;

        const commits = await this.gitService.getCommitsToPush(
            currentBranch,
            params.remote,
            params.branch
        );

        let files: CommitFile[] = [];
        if (commits.length > 0) {
            files = await this.gitService.getCommitFiles(commits[0].hash);
        }

        return {
            commits: commits,
            files: files
        };
    }

    async getCommitFiles(hash: string): Promise<CommitFile[]> {
        return await this.gitService.getCommitFiles(hash);
    }

    async getMultiCommitFiles(hashes: string[]): Promise<CommitFile[]> {
        const fileMap = new Map<string, CommitFile>();
        for (const hash of hashes) {
            try {
                const files = await this.gitService.getCommitFiles(hash);
                for (const file of files) {
                    fileMap.set(file.path, file);
                }
            } catch {
                // ignore
            }
        }
        return Array.from(fileMap.values());
    }

    async push(params: { force: boolean; pushTags: boolean; remote: string; branch: string }): Promise<void> {
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
    }

    async openDiff(filePath: string): Promise<void> {
        const workspaceRoot = this.gitService.getWorkspaceRoot();
        const uri = vscode.Uri.file(`${workspaceRoot}/${filePath}`);
        vscode.commands.executeCommand('git.openChange', uri);
    }

    async closeWebView(): Promise<void> {
        this.onDispose();
    }

    async openCommitDiff(params: { path: string; leftRef: string; rightRef: string }): Promise<void> {
        const leftUri = vscode.Uri.parse(`intelli-git-revision://load/${params.path}?${JSON.stringify({ ref: params.leftRef })}`);
        const rightUri = vscode.Uri.parse(`intelli-git-revision://load/${params.path}?${JSON.stringify({ ref: params.rightRef })}`);
        const title = `${path.basename(params.path)} (${params.leftRef.substring(0, 7)} ↔ ${params.rightRef.substring(0, 7)})`;
        vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
    }

    async getCommitState(): Promise<CommitState> {
        const changelists = await this._buildChangelists();
        const branches = await this.getBranchInfo();
        const incomingCommits = await this.gitService.getIncomingCommitsCount();
        const stashList = await this.gitService.getStashList();

        const rebaseStatus = branches.rebaseStatus;
        let recentCommitMessage = undefined;

        const shouldUpdateMessage = (rebaseStatus && rebaseStatus !== 'none') &&
            (this._lastRebaseStatus !== rebaseStatus);

        if (shouldUpdateMessage) {
            recentCommitMessage = await this.gitService.getRebaseCommitMessage();
        }
        this._lastRebaseStatus = rebaseStatus;

        return {
            changelists,
            branches,
            incomingCommits,
            stashList,
            recentCommitMessage
        };
    }

    async getChangelists(): Promise<ChangelistGroup[]> {
        return await this._buildChangelists();
    }

    async getBranchListData(): Promise<BranchListData> {
        const branches = await this.gitService.getBranches();
        const groupedRemote = await this.gitService.getGroupedRemoteBranches();
        const tags = await this.gitService.getTags();

        // Get ahead/behind info for each local branch
        const localBranchesInfo = await Promise.all(
            branches.all.map(async (branchName) => {
                const info = await this.gitService.getBranchAheadBehind(branchName);
                return {
                    name: branchName,
                    ahead: info.ahead,
                    behind: info.behind,
                    upstream: info.upstream
                };
            })
        );

        return {
            currentBranch: branches.current,
            localBranches: branches.all,
            localBranchesInfo,
            remoteBranches: groupedRemote,
            tags: tags
        };
    }

    async getBranchInfo(): Promise<BranchInfo> {
        const branches = await this.gitService.getBranches();
        const branchStatus = await this.gitService.getBranchStatus();
        const rebaseStatus = await this.gitService.getRebaseStatus();

        return {
            current: branches.current,
            all: branches.all,
            ahead: branchStatus.ahead,
            behind: branchStatus.behind,
            rebaseStatus
        };
    }

    async getLog(options: LogOptions): Promise<LogCommit[]> {
        return this.gitService.getLog(options);
    }

    async getCommitDetails(hash: string): Promise<CommitDetails> {
        return this.gitService.getCommitDetails(hash);
    }

    async getAuthors(): Promise<string[]> {
        return this.gitService.getAuthors();
    }

    async getCurrentUser(): Promise<string> {
        return this.gitService.getCurrentUser();
    }

    async pickPaths(): Promise<string[] | undefined> {
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
                // Handle selecting the workspace root itself
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
    }

    async pickBranchForFilter(): Promise<string | undefined> {
        const branchData = await this.getBranchListData();

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

        // "All" option
        items.push({
            label: `$(git-branch) ${i18n.t('extension.all')}`,
            branch: 'all',
            kind: vscode.QuickPickItemKind.Default
        });
        addedBranches.add('all');

        // Priority branches section
        items.push({
            label: i18n.t('extension.common'),
            kind: vscode.QuickPickItemKind.Separator,
            branch: ''
        });

        // HEAD
        addBranch('HEAD', '$(symbol-reference)', i18n.t('extension.currentHead'));

        // Current branch
        if (branchData.currentBranch) {
            addBranch(branchData.currentBranch, '$(git-branch)', i18n.t('extension.currentBranch'));
        }

        // main/master and their remotes
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

        // Separator for local branches
        items.push({
            label: i18n.t('extension.localBranches'),
            kind: vscode.QuickPickItemKind.Separator,
            branch: ''
        });

        for (const branch of branchData.localBranches) {
            addBranch(branch, '$(git-branch)');
        }

        // Remote branches grouped by remote
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

        // Return comma-separated branches for multiple selection
        const branches = selected.map(s => s.branch).filter(b => b);
        return branches.length === 1 ? branches[0] : branches.join(',');
    }

    private async _buildChangelists(): Promise<ChangelistGroup[]> {
        const files = await this.gitService.getStatus();

        const conflictedFiles = files.filter(f => f.status === 'C' || f.status === 'U');
        const trackedFiles = files.filter(f => f.status !== '?' && f.status !== 'C' && f.status !== 'U');
        const untrackedFiles = files.filter(f => f.status === '?');

        const changelists: ChangelistGroup[] = [];

        if (conflictedFiles.length > 0) {
            changelists.push({
                id: 'merge-conflicts',
                name: 'Merge Conflicts',
                isDefault: false,
                items: conflictedFiles.map(f => ({ path: f.path, status: f.status, staged: f.staged }))
            });
        }

        if (trackedFiles.length > 0) {
            if (this.changelistService) {
                const userChangelists = await this.changelistService.getChangelists();
                const filesByChangelist = new Map<string, typeof trackedFiles>();

                for (const file of trackedFiles) {
                    const listId = this.changelistService.getChangelistForFile(file.path);
                    if (!filesByChangelist.has(listId)) {
                        filesByChangelist.set(listId, []);
                    }
                    filesByChangelist.get(listId)!.push(file);
                }

                for (const cl of userChangelists) {
                    const clFiles = filesByChangelist.get(cl.id) || [];
                    if (clFiles.length > 0) {
                        changelists.push({
                            id: cl.id,
                            name: cl.name,
                            isDefault: cl.isDefault,
                            items: clFiles.map(f => ({ path: f.path, status: f.status, staged: f.staged }))
                        });
                    }
                }
            } else {
                changelists.push({
                    id: 'default',
                    name: 'Default Changelist',
                    isDefault: true,
                    items: trackedFiles.map(f => ({ path: f.path, status: f.status, staged: f.staged }))
                });
            }
        }

        if (untrackedFiles.length > 0) {
            changelists.push({
                id: 'unversioned',
                name: 'Unversioned Files',
                isDefault: false,
                items: untrackedFiles.map(f => ({ path: f.path, status: f.status, staged: f.staged }))
            });
        }

        if (changelists.length === 0) {
            changelists.push({
                id: 'default',
                name: 'Default Changelist',
                isDefault: true,
                items: []
            });
        }

        return changelists;
    }

    async getStashList(): Promise<StashItem[]> {
        return await this.gitService.getStashList();
    }

    async getStashFiles(index: number): Promise<CommitFile[]> {
        const files = await this.gitService.getStashFiles(index);
        return files.map(f => ({ path: f.path, status: f.status }));
    }

    async commit(params: { message: string; amend: boolean; files: string[]; push?: boolean }): Promise<void> {
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
    }

    async stage(filePath: string): Promise<void> {
        await this.gitService.stageFile(filePath);
    }

    async unstage(filePath: string): Promise<void> {
        await this.gitService.unstageFile(filePath);
    }

    async stageAll(): Promise<void> {
        await this.gitService.stageAll();
    }

    async unstageAll(): Promise<void> {
        await this.gitService.unstageAll();
    }

    async stash(params: { message?: string; files: string[] }): Promise<void> {
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
    }

    async deleteFiles(files: string[]): Promise<void> {
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
    }

    async rollback(files: string[]): Promise<void> {
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
    }

    async openFile(params: { path: string }): Promise<void> {
        const workspaceRoot = this.gitService.getWorkspaceRoot();
        if (!workspaceRoot) return;
        const uri = vscode.Uri.file(`${workspaceRoot}/${params.path}`);
        try {
            await vscode.workspace.fs.stat(uri);
            vscode.commands.executeCommand('vscode.open', uri);
        } catch {
            // File doesn't exist, possibly deleted
        }
    }

    async openStashDiff(params: { index: number; path: string }): Promise<void> {
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
    }

    async switchBranch(branch: string): Promise<void> {
        try {
            await this.gitService.switchBranch(branch);

        } catch (e) {
            vscode.window.showErrorMessage(i18n.t('extension.switchBranchFailed', `${e}`));
        }
    }

    async pull(): Promise<void> {
        try {
            await this.gitService.pull();
            vscode.window.showInformationMessage(i18n.t('extension.pullSuccess'));

        } catch (e) {
            vscode.window.showErrorMessage(i18n.t('extension.pullFailed', `${e}`));
        }
    }

    async fetch(): Promise<void> {
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
    }

    async pickBranch(): Promise<void> {
        await vscode.commands.executeCommand('intelli-git.showBranchPicker');
    }

    async continueRebase(params: { message?: string; files?: string[] }): Promise<void> {
        try {
            await this.gitService.continueRebase(params.message);
            vscode.window.showInformationMessage(i18n.t('extension.rebaseContinued'));

        } catch (e) {
            vscode.window.showErrorMessage(i18n.t('extension.continueRebaseFailed', `${e}`));
        }
    }

    async abortRebase(): Promise<void> {
        try {
            await this.gitService.abortRebase();
            vscode.window.showInformationMessage(i18n.t('extension.rebaseAborted'));

        } catch (e) {
            vscode.window.showErrorMessage(i18n.t('extension.abortRebaseFailed', `${e}`));
        }
    }

    async createChangelist(name: string): Promise<void> {
        await this.changelistService?.createChangelist(name);

    }

    async moveFiles(params: { files: string[]; targetListId: string }): Promise<void> {
        await this.changelistService?.moveFiles(params.files, params.targetListId);

    }

    async deleteChangelist(id: string): Promise<void> {
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
    }

    async renameChangelist(params: { id: string; name: string }): Promise<void> {
        await this.changelistService?.renameChangelist(params.id, params.name);

    }

    async promptCreateChangelist(file?: string): Promise<void> {
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
    }

    async generateCommitMessage(files?: string[]): Promise<string> {
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
    }
}
