import * as vscode from 'vscode';
import { GitService } from './GitService';
import { ChangelistService } from './ChangelistService';
import type { CommitViewMessage, ChangelistGroup, CommitViewExtMessage } from '@shared/messages';
import { getWebviewHtml } from './utils/webviewHtml';

export class CommitViewProvider implements vscode.WebviewViewProvider {

    public static readonly viewType = 'ideaCommitView';
    private _view?: vscode.WebviewView;
    private gitService?: GitService;
    private changelistService: ChangelistService;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        gitService: GitService,
        changelistService: ChangelistService
    ) {
        this.gitService = gitService;
        this.changelistService = changelistService;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Listen to active text editor changes
        const activeEditorListener = vscode.window.onDidChangeActiveTextEditor(editor => {
            if (!editor) return;

            const uri = editor.document.uri;
            let relativePath: string | null = null;

            if (uri.scheme === 'file') {
                relativePath = vscode.workspace.asRelativePath(uri, false);
            } else if (uri.scheme === 'git') {
                // git diff view: path is like /path/to/file.ts
                relativePath = vscode.workspace.asRelativePath(vscode.Uri.file(uri.path), false);
            }

            if (relativePath) {
                if (relativePath) {
                    this._postMessage({
                        type: 'activeFileChange',
                        path: relativePath
                    });
                }
            }
        });

        webviewView.onDidDispose(() => {
            activeEditorListener.dispose();
        });


        webviewView.webview.onDidReceiveMessage(async (data: CommitViewMessage & { command?: string }) => {
            if (!this.gitService) {
                return;
            }

            const msg = { ...data, type: data.command || data.type } as CommitViewMessage;

            switch (msg.type) {
                case 'refresh': this.refresh(); break;
                case 'commit': await this._handleCommit(msg.message, msg.amend, msg.files); break;
                case 'commitAndPush': await this._handleCommitAndPush(msg.message, msg.amend, msg.files); break;
                case 'stage': await this.gitService.stageFile(msg.path); this.refresh(); break;
                case 'unstage': await this.gitService.unstageFile(msg.path); this.refresh(); break;
                case 'stage-all': await this.gitService.stageAll(); this.refresh(); break;
                case 'unstage-all': await this.gitService.unstageAll(); this.refresh(); break;
                case 'switchBranch': await this._handleSwitchBranch(msg.branch); break;
                case 'updateProject': await this._handleUpdateProject(); break;
                case 'requestPush': await vscode.commands.executeCommand('idea-commit-panel.push'); break;
                case 'openFile': await this._handleOpenFile(msg.path, msg.status); break;
                case 'getLastCommitMessage': await this._sendLastCommitMessage(); break;
                case 'generateCommitMessage': await this._generateCommitMessage(msg.files); break;
                case 'stash': await this._handleStash(msg.files); break;
                case 'rollback': await this._handleRollback(msg.files); break;
                case 'getChangedFiles': await this._sendChangedFiles(); break;
                case 'getStashList': await this._sendStashList(); break;
                case 'stashApply': await this._handleApplyStash(msg.index); break;
                case 'stashPop': await this._handlePopStash(msg.index); break;
                case 'stashDrop': await this._handleDropStash(msg.index); break;
                case 'getStashFiles': await this._sendStashFiles(msg.index); break;
                case 'showStashFileDiff': await this._showStashFileDiff(msg.index, msg.filePath); break;
                case 'showStashActions': await this._showStashActions(msg.index); break;
                case 'rollbackWithPick': await this._handleRollbackWithPick(); break;
                case 'createChangelist': await this.changelistService.createChangelist(msg.name); this.refresh(); break;
                case 'moveFiles': await this.changelistService.moveFiles(msg.files, msg.targetListId); this.refresh(); break;
                case 'deleteChangelist': {
                    const list = this.changelistService.getChangelistById(msg.id);
                    if (list && list.files.length > 0) {
                        await this._handleDeleteChangelist(msg.id);
                    } else {
                        await this.changelistService.removeChangelist(msg.id);
                        this.refresh();
                    }
                    break;
                }
                case 'renameChangelist': await this.changelistService.renameChangelist(msg.id, msg.name); this.refresh(); break;
                case 'promptCreateChangelist': {
                    const newName = await vscode.window.showInputBox({
                        prompt: 'Enter new changelist name',
                        placeHolder: 'New Changelist'
                    });
                    if (newName) {
                        const newId = await this.changelistService.createChangelist(newName);
                        if (msg.file) {
                            await this.changelistService.moveFiles([msg.file], newId);
                        }
                        this.refresh();
                    }
                    break;
                }
                case 'deleteFiles': await this._handleDeleteFiles(msg.files); this.refresh(); break;
                case 'stashChangelist': await this._handleStash(msg.files); break;
                case 'fetch':
                    await this._handleFetch();
                    break;
                case 'pull':
                    await this._handlePull();
                    break;
                case 'pickBranch':
                    vscode.commands.executeCommand('idea-commit-panel.showBranchPicker');
                    break;
                case 'openMergeEditor':
                    await this._handleOpenMergeEditor(msg.path);
                    break;
                case 'continueRebase':
                    this._handleContinueRebase(msg.message, msg.files);
                    break;
                case 'abortRebase':
                    await this._handleAbortRebase();
                    break;
                case 'log': console.log('[Webview]', msg.message); break;
            }
        });


        this.refresh();
    } // Close resolveWebviewView

    // State to track if we have already populated the rebase message for the current session
    private _lastRebaseStatus: string | undefined;

    public async refresh() {
        if (!this.gitService || !this._view) {
            return;
        }

        const files = await this.gitService.getStatus();
        // Use helper to get all branch info at once
        const branches = await this._getBranchInfo();

        const incomingCommits = await this.gitService.getIncomingCommitsCount();
        console.log('[CommitViewProvider] Refreshing. Incoming commits:', incomingCommits);

        // Create changelist groups
        // Conflict Group
        const conflictedFiles = files.filter(f => f.status === 'C' || f.status === 'U');

        // Tracked Group (staged + modified + deleted, but NOT conflicted)
        const trackedFiles = files.filter(f => f.status !== '?' && f.status !== 'C' && f.status !== 'U');

        // Untracked Group
        const untrackedFiles = files.filter(f => f.status === '?');

        const changelists: ChangelistGroup[] = [];

        // 1. Merge Conflicts (Highest priority)
        if (conflictedFiles.length > 0) {
            changelists.push({
                id: 'merge-conflicts',
                name: 'Merge Conflicts',
                isDefault: false,
                items: conflictedFiles.map(f => ({ path: f.path, status: f.status, staged: f.staged }))
            });
        }

        // 2. Default Changelist (Tracked non-conflicted files)
        if (trackedFiles.length > 0) {
            // Check if we have user-defined changelists for these files
            // For now, simplify logic: All tracked files go to 'Default' or their assigned list by ChangelistService
            // If using ChangelistService:
            const defaultId = (await this.changelistService.getChangelists()).find(c => c.isDefault)?.id || 'default';
            const userChangelists = await this.changelistService.getChangelists();

            // Map files to changelists
            const filesByChangelist = new Map<string, typeof trackedFiles>();

            for (const file of trackedFiles) {
                const listId = this.changelistService.getChangelistForFile(file.path);
                if (!filesByChangelist.has(listId)) {
                    filesByChangelist.set(listId, []);
                }
                filesByChangelist.get(listId)!.push(file);
            }

            // Create groups for existing changelists (so empty ones persist if managed by service)
            for (const cl of userChangelists) {
                const clFiles = filesByChangelist.get(cl.id) || [];
                // Only skip if empty AND not default? Or show empty changelists?
                // Logic: Show if it has files.
                if (clFiles.length > 0) {
                    changelists.push({
                        id: cl.id,
                        name: cl.name,
                        isDefault: cl.isDefault,
                        items: clFiles.map(f => ({ path: f.path, status: f.status, staged: f.staged }))
                    });
                } else if (cl.isDefault && trackedFiles.length === 0 && conflictedFiles.length === 0 && untrackedFiles.length === 0) {
                    // Show default even if empty if no other files exist?? 
                    // No, usually just hide.
                }
            }
            // Add any files that fell into 'default' bucket implicitly if not covered above?
            // The service defaults unknown files to default list, so usually covered.
        }

        // 3. Unversioned Files
        if (untrackedFiles.length > 0) {
            changelists.push({
                id: 'unversioned',
                name: 'Unversioned Files',
                isDefault: false,
                items: untrackedFiles.map(f => ({ path: f.path, status: f.status, staged: f.staged }))
            });
        }

        // Safety: ensure default exists if needed?
        if (changelists.length === 0) {
            changelists.push({
                id: 'default',
                name: 'Default Changelist',
                isDefault: true,
                items: []
            });
        }

        // Check if we are rebasing or merging to pre-populate message
        const rebaseStatus = branches.rebaseStatus;

        // Only trigger message update if we trigger a transition TO meaningful status from non-meaningful
        // OR if this is the first load (lastRebaseStatus undefined) and it is active.
        // Prevent overwriting if we are already in the state.
        const shouldUpdateMessage = (rebaseStatus && rebaseStatus !== 'none') &&
            (this._lastRebaseStatus !== rebaseStatus);

        if (shouldUpdateMessage) {
            let existingMessage = await this.gitService.getRebaseCommitMessage();
            this._postMessage({
                type: 'setCommitMessage',
                message: existingMessage
            });
        }

        // Update state
        this._lastRebaseStatus = rebaseStatus;

        this._postMessage({
            type: 'update',
            files: changelists,
            branches: branches, // Use helper result
            incomingCommits
        });

        this._sendActiveFile();
    }

    public switchTab(tab: 'commit' | 'stash') {
        this._postMessage({
            type: 'switchTab',
            tab: tab
        });
    }

    private async _handleCommit(message: string, amend: boolean, files: string[]) {
        if (!this.gitService) return;
        try {
            if (amend) {
                await this.gitService.commitAmend(message, files);
            } else {
                await this.gitService.commit(message, files);
            }
            vscode.window.showInformationMessage('Commit successful');
            this.commitMessage = ''; // Clear message logic if needed, but frontend handles it
            this._postMessage({ type: 'setCommitMessage', message: '' });
            this.refresh();
        } catch (e) {
            vscode.window.showErrorMessage(`Commit failed: ${e}`);
        }
    }

    private async _handleCommitAndPush(message: string, amend: boolean, files: string[]) {
        if (!this.gitService) return;
        try {
            await this._handleCommit(message, amend, files);
            const branches = await this.gitService.getBranches();
            if (branches.current) {
                await this.gitService.push('origin', branches.current);
                vscode.window.showInformationMessage('Push successful');
            }
        } catch (e) {
            vscode.window.showErrorMessage(`Push failed: ${e}`);
        }
    }

    private async _handleSwitchBranch(branchName: string) {
        if (!this.gitService) return;
        try {
            await this.gitService.switchBranch(branchName);
            this.refresh();
        } catch (e) {
            vscode.window.showErrorMessage(`Switch branch failed: ${e}`);
        }
    }

    private async _handleUpdateProject() {
        if (!this.gitService) return;
        try {
            await this.gitService.pull();
            this.refresh();
            vscode.window.showInformationMessage('Project updated');
        } catch (e) {
            vscode.window.showErrorMessage(`Update failed: ${e}`);
        }
    }

    private async _handleOpenFile(path: string, status?: string) {
        const workspaceRoot = this.gitService?.getWorkspaceRoot();
        if (!workspaceRoot) return;
        if (status === 'D') {
            // Deleted file: use VSCode's built-in git.openChange command
            const uri = vscode.Uri.file(`${workspaceRoot}/${path}`);
            await vscode.commands.executeCommand('git.openChange', uri);
        } else {
            const uri = vscode.Uri.file(`${workspaceRoot}/${path}`);
            vscode.commands.executeCommand('vscode.open', uri);
        }
    }

    private async _sendLastCommitMessage() {
        if (!this.gitService) return;
        const message = await this.gitService.getLastCommitMessage();
        this._postMessage({
            type: 'lastCommitMessage',
            message: message
        });
    }

    // Placeholder for AI commit message generation
    private async _generateCommitMessage(files?: string[]) {
        if (!this.gitService) {
            return;
        }
        this._postMessage({
            type: 'aiGenerating',
            generating: true
        });

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
                this._postMessage({
                    type: 'aiGenerating',
                    generating: false
                });
                return;
            }

            // Try to find a Copilot model first, but don't restrict to specific family like 'gpt-4o'
            // as new models (like 'gpt-5-mini') might be available.
            let [model] = await vscode.lm.selectChatModels({ vendor: 'copilot' });

            // If no Copilot model, try ANY available model
            if (!model) {
                const models = await vscode.lm.selectChatModels();
                if (models.length > 0) {
                    model = models[0];
                }
            }

            console.log('Selected AI Model:', model ? `${model.vendor} - ${model.name} (${model.family})` : 'None');

            if (!model) {
                vscode.window.showErrorMessage('No suitable AI model found. Please ensure GitHub Copilot Chat is installed and enabled.');
                this._postMessage({
                    type: 'aiGenerating',
                    generating: false
                });
                return;
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

            this._postMessage({
                type: 'generatedCommitMessage',
                message: fullMessage.trim()
            });
        } catch (e) {
            console.error('Error generating commit message:', e);
            vscode.window.showErrorMessage(`Failed to generate commit message: ${e}`);
        } finally {
            this._postMessage({
                type: 'aiGenerating',
                generating: false
            });
        }
    }

    private async _handleStash(files: string[]) {
        if (!this.gitService) return;
        try {
            const message = await vscode.window.showInputBox({
                placeHolder: 'Stash message (optional)'
            });
            await this.gitService.stash(message, files);
            vscode.window.showInformationMessage('Stash successful');
            this.refresh();
        } catch (e) {
            vscode.window.showErrorMessage(`Stash failed: ${e}`);
        }
    }

    private async _handleRollback(files: string[]) {
        if (!this.gitService) return;
        const answer = await vscode.window.showWarningMessage(
            `Are you sure you want to rollback ${files.length} files? This cannot be undone.`,
            { modal: true },
            'Rollback'
        );
        if (answer === 'Rollback') {
            try {
                await this.gitService.rollbackFiles(files);
                this.refresh();
            } catch (e) {
                vscode.window.showErrorMessage(`Rollback failed: ${e}`);
            }
        }
    }

    private async _sendChangedFiles() {
        this.refresh();
    }

    private async _sendStashList() {
        if (!this.gitService) return;
        const list = await this.gitService.getStashList();
        this._postMessage({
            type: 'stashList',
            stashList: list
        });
    }

    private async _handleApplyStash(index: number) {
        if (!this.gitService) return;
        try {
            await this.gitService.applyStash(index);
            vscode.window.showInformationMessage('Stash applied');
            this.refresh();
        } catch (e) {
            vscode.window.showErrorMessage(`Apply stash failed: ${e}`);
        }
    }

    private async _handlePopStash(index: number) {
        if (!this.gitService) return;
        try {
            await this.gitService.popStash(index);
            vscode.window.showInformationMessage('Stash popped');
            this.refresh();
            await this._sendStashList();
        } catch (e) {
            vscode.window.showErrorMessage(`Pop stash failed: ${e}`);
        }
    }

    private async _handleDropStash(index: number) {
        if (!this.gitService) return;
        const answer = await vscode.window.showWarningMessage(
            'Are you sure you want to drop this stash?',
            { modal: true },
            'Drop'
        );
        if (answer === 'Drop') {
            try {
                await this.gitService.dropStash(index);
                this._sendStashList();
            } catch (e) {
                vscode.window.showErrorMessage(`Drop stash failed: ${e}`);
            }
        }
    }

    private async _sendStashFiles(index: number) {
        if (!this.gitService) return;
        const files = await this.gitService.getStashFiles(index);
        this._postMessage({
            type: 'stashFiles',
            index: index,
            files: files.map(f => ({ ...f, staged: false }))
        });
    }

    private async _showStashFileDiff(index: number, filePath: string) {
        // Construct URIs for diff
        // Left: stash@{index}^1 (Parent)
        // Right: stash@{index} (The stash) or just Read-only content

        const stashRef = `stash@{${index}}`;
        const leftRef = `${stashRef}^1`;

        const leftUri = vscode.Uri.parse(`idea-stash://load/left?${JSON.stringify({ ref: leftRef, path: filePath })}`);
        const rightUri = vscode.Uri.parse(`idea-stash://load/right?${JSON.stringify({ ref: stashRef, path: filePath })}`);

        const fileName = filePath.split('/').pop();

        await vscode.commands.executeCommand('vscode.diff',
            leftUri,
            rightUri,
            `${fileName} (Stash vs Parent)`
        );
    }

    private async _showStashActions(index: number) {
        // Simple QuickPick for fallback if context menu fails
        const actions = ['Apply', 'Pop', 'Drop'];
        const choice = await vscode.window.showQuickPick(actions, { placeHolder: `Actions for stash@{${index}}` });
        if (choice === 'Apply') this._handleApplyStash(index);
        if (choice === 'Pop') this._handlePopStash(index);
        if (choice === 'Drop') this._handleDropStash(index);
    }

    private async _handleRollbackWithPick() {
        // Not implemented or legacy?
        // Just refresh for now
        this.refresh();
    }

    private async _handleDeleteChangelist(id: string) {
        const answer = await vscode.window.showWarningMessage(
            'Changelist is not empty. Delete it and move files to Default?',
            { modal: true },
            'Delete'
        );

        if (answer === 'Delete') {
            await this.changelistService.removeChangelist(id); // Service handles moving files to default if deleted
            this.refresh();
        }
    }

    private async _handleDeleteFiles(files: string[]) {
        // "Delete Files" usually means delete from disk or just revert?
        // "Delete" in context menu usually means delete from disk.
        // Be careful.
        const answer = await vscode.window.showWarningMessage(
            `Are you sure you want to delete ${files.length} files from disk?`,
            { modal: true },
            'Delete'
        );
        if (answer === 'Delete') {
            // Using vscode.workspace.fs to delete
            const workspaceRoot = this.gitService?.getWorkspaceRoot();
            if (!workspaceRoot) return;

            try {
                for (const file of files) {
                    const uri = vscode.Uri.file(`${workspaceRoot}/${file}`);
                    await vscode.workspace.fs.delete(uri, { recursive: false, useTrash: true });
                }
                this.refresh();
            } catch (e) {
                vscode.window.showErrorMessage(`Delete failed: ${e}`);
            }
        }
    }

    // Member variable for commit message state if we want to preserve it, 
    // though frontend usually holds it.
    private commitMessage = '';


    private _sendActiveFile() {
        if (!this._view) return;
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const uri = editor.document.uri;
        let relativePath: string | null = null;

        if (uri.scheme === 'file') {
            relativePath = vscode.workspace.asRelativePath(uri, false);
        } else if (uri.scheme === 'git') {
            relativePath = vscode.workspace.asRelativePath(vscode.Uri.file(uri.path), false);
        }

        if (relativePath) {
            this._postMessage({
                type: 'activeFileChange',
                path: relativePath
            });
        }
    }

    private async _handleFetch() {
        if (!this.gitService) return;

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Fetching...",
            cancellable: true
        }, async (progress, token) => {
            try {
                await this.gitService!.fetch();
                if (!token.isCancellationRequested) {
                    vscode.window.showInformationMessage('Fetch completed');
                }
            } catch (e) {
                if (!token.isCancellationRequested) {
                    vscode.window.showErrorMessage(`Fetch failed: ${e}`);
                }
            } finally {
                this.refresh();
            }
        });
    }

    private async _handleOpenMergeEditor(filePath: string) {
        const workspaceRoot = this.gitService?.getWorkspaceRoot();
        if (!workspaceRoot) return;
        const uri = vscode.Uri.file(`${workspaceRoot}/${filePath}`);
        await vscode.commands.executeCommand('git.openMergeEditor', uri);
    }

    private async _handleContinueRebase(message?: string, files?: string[]) {
        if (!this.gitService) return;

        // If specific files are selected/provided, stage them first
        // This supports the workflow where user resolves conflict, checks the file in UI, and clicks Continue
        if (files && files.length > 0) {
            try {
                // We stage individually or all at once
                // simple-git add accepts array or space-separated? verify.
                // existing stageFile takes single path.
                for (const file of files) {
                    await this.gitService.stageFile(file);
                }
            } catch (e) {
                console.error('Failed to stage files before continue:', e);
                vscode.window.showErrorMessage('Failed to stage selected files.');
                return;
            }
        }

        try {
            await this.gitService.continueRebase(message);
            vscode.window.showInformationMessage('Rebase continued.');

            // Clear the message input
            this._postMessage({ type: 'setCommitMessage', message: '' });

            // Invalidate the last rebase status so the next refresh (which will likely still be 'interactive' 
            // if there is another conflict) triggers a message update to the new conflict message.
            this._lastRebaseStatus = undefined;

            this.refresh();
        } catch (e) {
            vscode.window.showErrorMessage(`Continue rebase failed: ${e}`);
        }
    }

    private async _handleAbortRebase() {
        if (!this.gitService) return;
        try {
            await this.gitService.abortRebase();
            vscode.window.showInformationMessage('Rebase aborted.');
            this.refresh();
        } catch (e) {
            vscode.window.showErrorMessage(`Abort rebase failed: ${e}`);
        }
    }

    private async _getBranchInfo() {
        if (!this.gitService) return { current: '', all: [] };

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


    private async _handlePull() {
        if (!this.gitService) return;
        try {
            await this.gitService.pull(); // Using pull (git pull) which usually includes rebase if configured or merge
            this.refresh();
            vscode.window.showInformationMessage('Pull successful');
        } catch (e) {
            vscode.window.showErrorMessage(`Pull failed: ${e}`);
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return getWebviewHtml({
            webview,
            extensionUri: this._extensionUri,
            title: 'Commit'
        });
    }

    private _postMessage(message: CommitViewExtMessage) {
        this._view?.webview.postMessage(message);
    }
}
