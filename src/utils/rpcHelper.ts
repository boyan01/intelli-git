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
    getCommitState?: () => Promise<CommitState>;
    getChangelists?: () => Promise<ChangelistGroup[]>;
    getBranchInfo?: () => Promise<BranchInfo>;
    generateCommitMessage?: (files?: string[]) => Promise<string>;
}

/**
 * Full implementation of ExtensionMethods interface for RPC handling.
 * Encapsulates all Git and Changelist operations.
 */
export class ExtensionRpcHandler implements ExtensionMethods {
    private gitService: GitService;
    private changelistService?: ChangelistService;
    private onDispose: () => void;
    private getCommitStateFn?: () => Promise<CommitState>;
    private getChangelistsFn?: () => Promise<ChangelistGroup[]>;
    private getBranchInfoFn?: () => Promise<BranchInfo>;
    private generateCommitMessageFn?: (files?: string[]) => Promise<string>;

    constructor(options: ExtensionRpcHandlerOptions) {
        this.gitService = options.gitService;
        this.changelistService = options.changelistService;
        this.onDispose = options.onDispose || (() => { });
        this.getCommitStateFn = options.getCommitState;
        this.getChangelistsFn = options.getChangelists;
        this.getBranchInfoFn = options.getBranchInfo;
        this.generateCommitMessageFn = options.generateCommitMessage;
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
        if (this.getCommitStateFn) {
            return await this.getCommitStateFn();
        }
        return {
            changelists: [],
            branches: { current: '', all: [] },
            incomingCommits: 0,
            stashList: []
        };
    }

    async getChangelists(): Promise<ChangelistGroup[]> {
        if (this.getChangelistsFn) {
            return await this.getChangelistsFn();
        }
        return [];
    }

    async getBranchInfo(): Promise<BranchInfo> {
        if (this.getBranchInfoFn) {
            return await this.getBranchInfoFn();
        }
        return { current: '', all: [] };
    }

    async getStashList(): Promise<StashItem[]> {
        return await this.gitService.getStashList();
    }

    async getIncomingCommits(): Promise<number> {
        return await this.gitService.getIncomingCommitsCount();
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

    async generateCommitMessage(files?: string[]): Promise<string> {
        if (this.generateCommitMessageFn) {
            return await this.generateCommitMessageFn(files);
        }
        return '';
    }

    // ===========================================
    // Stash methods
    // ===========================================

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

    async popStash(index: number): Promise<void> {
        try {
            await this.gitService.popStash(index);
            vscode.window.showInformationMessage('Stash popped');

        } catch (e) {
            vscode.window.showErrorMessage(`Pop stash failed: ${e}`);
        }
    }

    async applyStash(index: number): Promise<void> {
        try {
            await this.gitService.applyStash(index);
            vscode.window.showInformationMessage('Stash applied');

        } catch (e) {
            vscode.window.showErrorMessage(`Apply stash failed: ${e}`);
        }
    }

    async dropStash(index: number): Promise<void> {
        const answer = await vscode.window.showWarningMessage(
            'Are you sure you want to drop this stash?',
            { modal: true },
            'Drop'
        );
        if (answer === 'Drop') {
            try {
                await this.gitService.dropStash(index);

            } catch (e) {
                vscode.window.showErrorMessage(`Drop stash failed: ${e}`);
            }
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
