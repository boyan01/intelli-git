import * as vscode from 'vscode';
import * as path from 'path';
import { RpcPeer } from '../../shared/rpc';
import type { WebviewMethods, ExtensionMethods, CommitFile, CommitState, PushCommitsData, PushInitState, ChangelistGroup, BranchInfo, StashItem } from '../../shared/messages';
import { GitService } from '../services/GitService';
import { ChangelistService } from '../services/ChangelistService';

export interface RpcHelperOptions {
    webview: vscode.Webview;
    onDisposed?: () => boolean;
}

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
            `Successfully pushed to ${params.remote}/${params.branch}`
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
        const leftUri = vscode.Uri.parse(`idea-revision://load/${params.path}?${JSON.stringify({ ref: params.leftRef })}`);
        const rightUri = vscode.Uri.parse(`idea-revision://load/${params.path}?${JSON.stringify({ ref: params.rightRef })}`);
        const title = `${path.basename(params.path)} (${params.leftRef.substring(0, 7)} ↔ ${params.rightRef.substring(0, 7)})`;
        vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
    }

    // ===========================================
    // Commit methods
    // ===========================================

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
                    vscode.window.showInformationMessage('Push successful');
                }
            } else {
                vscode.window.showInformationMessage('Commit successful');
            }

        } catch (e) {
            vscode.window.showErrorMessage(`Commit failed: ${e}`);
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
                    placeHolder: 'Stash message (optional)'
                });
            }
            await this.gitService.stash(message, params.files);
            vscode.window.showInformationMessage('Stash successful');
        } catch (e) {
            vscode.window.showErrorMessage(`Stash failed: ${e}`);
        }
    }

    // ===========================================
    // File operations
    // ===========================================

    async deleteFiles(files: string[]): Promise<void> {
        const answer = await vscode.window.showWarningMessage(
            `Are you sure you want to delete ${files.length} files from disk?`,
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
                vscode.window.showErrorMessage(`Delete failed: ${e}`);
            }
        }
    }

    async rollback(files: string[]): Promise<void> {
        const answer = await vscode.window.showWarningMessage(
            `Are you sure you want to rollback ${files.length} files? This cannot be undone.`,
            { modal: true },
            'Rollback'
        );
        if (answer === 'Rollback') {
            try {
                await this.gitService.rollbackFiles(files);

            } catch (e) {
                vscode.window.showErrorMessage(`Rollback failed: ${e}`);
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

    // ===========================================
    // Branch operations
    // ===========================================

    async switchBranch(branch: string): Promise<void> {
        try {
            await this.gitService.switchBranch(branch);

        } catch (e) {
            vscode.window.showErrorMessage(`Switch branch failed: ${e}`);
        }
    }

    async pull(): Promise<void> {
        try {
            await this.gitService.pull();
            vscode.window.showInformationMessage('Project updated');

        } catch (e) {
            vscode.window.showErrorMessage(`Pull failed: ${e}`);
        }
    }

    async fetch(): Promise<void> {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Fetching...",
            cancellable: true
        }, async (progress, token) => {
            try {
                await this.gitService.fetch();
                if (!token.isCancellationRequested) {
                    vscode.window.showInformationMessage('Fetch completed');
                }
            } catch (e) {
                if (!token.isCancellationRequested) {
                    vscode.window.showErrorMessage(`Fetch failed: ${e}`);
                }
            } finally {

            }
        });
    }

    async pickBranch(): Promise<void> {
        await vscode.commands.executeCommand('idea-commit-panel.showBranchPicker');
    }

    // ===========================================
    // Rebase operations
    // ===========================================

    async continueRebase(params: { message?: string; files?: string[] }): Promise<void> {
        try {
            await this.gitService.continueRebase(params.message);
            vscode.window.showInformationMessage('Rebase continued');

        } catch (e) {
            vscode.window.showErrorMessage(`Continue rebase failed: ${e}`);
        }
    }

    async abortRebase(): Promise<void> {
        try {
            await this.gitService.abortRebase();
            vscode.window.showInformationMessage('Rebase aborted');

        } catch (e) {
            vscode.window.showErrorMessage(`Abort rebase failed: ${e}`);
        }
    }

    // ===========================================
    // Changelist operations
    // ===========================================

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
                `Changelist '${list.name}' is not empty. Delete it and move files to default?`,
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
            prompt: 'Enter new changelist name',
            placeHolder: 'New Changelist'
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
                    ? 'No changes found for selected files.'
                    : 'No staged changes to generate commit message for.';
                vscode.window.showInformationMessage(message);
                return '';
            }

            let [model] = await vscode.lm.selectChatModels({ vendor: 'copilot' });
            if (!model) {
                const models = await vscode.lm.selectChatModels();
                if (models.length > 0) model = models[0];
            }

            if (!model) {
                throw new Error('No suitable AI model found. Please ensure GitHub Copilot Chat is installed and enabled.');
            }

            const messages = [
                vscode.LanguageModelChatMessage.User('Generate a concise commit message based on the following diff. Use the conventional commits format (e.g. feat: ..., fix: ...). Only return the commit message, no explanation, no code blocks'),
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
            vscode.window.showErrorMessage(`Failed to generate commit message: ${e}`);
            throw e;
        }
    }
}

/**
 * Creates and initializes an RpcPeer for a VS Code webview.
 * Handles duplicate logic for postMessage safety on disposed webviews.
 */
export function createRpc(options: RpcHelperOptions): RpcPeer<WebviewMethods, ExtensionMethods> {
    const { webview, onDisposed } = options;

    const rpc = new RpcPeer<WebviewMethods, ExtensionMethods>({
        postMessage: (msg: any) => {
            if (onDisposed && onDisposed()) {
                return;
            }
            try {
                webview.postMessage(msg);
            } catch (error) {
                if (!onDisposed || !onDisposed()) {
                    console.error('Failed to post message to webview:', error);
                }
            }
        }
    });

    return rpc;
}

/**
 * Helper to handle incoming webview messages for RPC.
 * Returns a function suitable for webview.onDidReceiveMessage
 */
export function createRpcMessageHandler(rpc: RpcPeer<any, any>) {
    return (message: any) => {
        if (message.type === 'rpc-request' || message.type === 'rpc-response') {
            rpc.handleMessage(message);
            return true;
        }
        return false;
    };
}
