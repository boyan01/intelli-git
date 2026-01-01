import * as vscode from 'vscode';
import { GitService, FileStatus } from './GitService';
import { ChangelistService } from './ChangelistService';

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
            if (editor && editor.document.uri.scheme === 'file') {
                 // Convert to relative path to match Git status paths
                 const relativePath =  vscode.workspace.asRelativePath(editor.document.uri, false);
                 this._view?.webview.postMessage({
                     type: 'activeFileChange',
                     path: relativePath
                 });
            }
        });
        
        webviewView.onDidDispose(() => {
            activeEditorListener.dispose();
        });

        // Initial update of active file
        if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri.scheme === 'file') {
             const relativePath =  vscode.workspace.asRelativePath(vscode.window.activeTextEditor.document.uri, false);
             this._view?.webview.postMessage({
                 type: 'activeFileChange',
                 path: relativePath
             });
        }

        webviewView.webview.onDidReceiveMessage(async (data) => {
            if (!this.gitService) {
                return;
            }

            // Support both 'type' (legacy) and 'command' (new React app)
            const command = data.command || data.type;

            switch (command) {
                case 'refresh':
                    this.refresh();
                    break;
                case 'commit':
                    await this._handleCommit(data.message, data.amend, data.files);
                    break;
                case 'commitAndPush':
                    await this._handleCommitAndPush(data.message, data.amend, data.files);
                    break;
                case 'stage':
                    await this.gitService.stageFile(data.path);
                    this.refresh();
                    break;
                case 'unstage':
                    await this.gitService.unstageFile(data.path);
                    this.refresh();
                    break;
                case 'stage-all':
                    await this.gitService.stageAll();
                    this.refresh();
                    break;
                case 'unstage-all':
                    await this.gitService.unstageAll();
                    this.refresh();
                    break;
                case 'switchBranch':
                    await this._handleSwitchBranch(data.branch);
                    break;
                case 'updateProject':
                    await this._handleUpdateProject();
                    break;
                case 'requestPush':
                    vscode.commands.executeCommand('idea-commit-panel.push');
                    break;
                case 'openFile':
                    this._handleOpenFile(data.path);
                    break;
                case 'getLastCommitMessage':
                    await this._sendLastCommitMessage();
                    break;
                case 'generateCommitMessage':
                    await this._generateCommitMessage();
                    break;
                case 'stash':
                    await this._handleStash(data.files);
                    break;
                case 'rollback':
                    await this._handleRollback(data.files);
                    break;
                case 'getChangedFiles':
                    await this._sendChangedFiles();
                    break;
                case 'getStashList':
                    await this._sendStashList();
                    break;
                case 'applyStash':
                case 'stashApply':
                    await this._handleApplyStash(data.index);
                    break;
                case 'popStash':
                case 'stashPop':
                    await this._handlePopStash(data.index);
                    break;
                case 'dropStash':
                case 'stashDrop':
                    await this._handleDropStash(data.index);
                    break;
                case 'getStashFiles':
                    await this._sendStashFiles(data.index);
                    break;
                case 'showStashFileDiff':
                    await this._showStashFileDiff(data.index, data.filePath);
                    break;
                case 'showStashActions':
                    await this._showStashActions(data.index);
                    break;
                case 'rollbackWithPick':
                    await this._handleRollbackWithPick();
                    break;
                case 'createChangelist':
                    await this.changelistService.createChangelist(data.name);
                    this.refresh();
                    break;
                case 'moveFiles':
                    await this.changelistService.moveFiles(data.files, data.targetListId);
                    this.refresh();
                    break;
                case 'deleteChangelist':
                    // Check if empty is handled in frontend or need check here?
                    // Let's check here to be safe or if frontend requests direct delete
                    const listToDelete = this.changelistService.getChangelistById(data.id);
                    if (listToDelete && listToDelete.files.length > 0) {
                        await this._handleDeleteChangelist(data.id);
                    } else {
                        await this.changelistService.removeChangelist(data.id);
                        this.refresh();
                    }
                    break;
                case 'renameChangelist':
                    await this.changelistService.renameChangelist(data.id, data.name);
                    this.refresh();
                    break;
                case 'promptCreateChangelist':
                    const newName = await vscode.window.showInputBox({ 
                        prompt: 'Enter new changelist name',
                        placeHolder: 'New Changelist'
                    });
                    if (newName) {
                        const newId = await this.changelistService.createChangelist(newName);
                        if (data.file) {
                            await this.changelistService.moveFiles([data.file], newId);
                        }
                        this.refresh();
                    }
                    break;
                case 'deleteFiles':
                    await this._handleDeleteFiles(data.files);
                    this.refresh();
                    break;
                case 'stashChangelist':
                    await this._handleStash(data.files); // Re-use stash handler
                    break;
            }
        });


        this.refresh();
    } // Close resolveWebviewView

    public async refresh() {
        if (!this.gitService || !this._view) {
            return;
        }

        const files = await this.gitService.getStatus();
        const branches = await this.gitService.getBranches();
        
        // Use ChangelistService to group files
        // Sync with service first (ensure all files are in some list)
        this.changelistService.syncWithStatus(files);
        const rawChangelists = this.changelistService.getChangelists();

        // Map to frontend format
        const changelists = rawChangelists.map(list => ({
            id: list.id,
            name: list.name,
            isDefault: list.isDefault,
            items: list.files.map(path => {
                const file = files.find(f => f.path === path);
                // Should always find file after sync, but handle safely
                if (!file) {
                    console.warn(`File ${path} in changelist ${list.name} not found in status`);
                    return null;
                }
                return {
                    path: path,
                    status: file.status,
                    staged: file.staged
                };
            }).filter((item): item is {path: string, status: string, staged: boolean} => item !== null)
        }));

        this._view.webview.postMessage({
            type: 'update',
            files: changelists,
            branches: branches
        });
    }

    public switchTab(tab: 'commit' | 'stash') {
        this._view?.webview.postMessage({
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
            this._view?.webview.postMessage({ type: 'clearMessage' });
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

    private _handleOpenFile(path: string) {
        const workspaceRoot = this.gitService?.getWorkspaceRoot();
        if (workspaceRoot) {
            const uri = vscode.Uri.file(`${workspaceRoot}/${path}`);
            vscode.commands.executeCommand('vscode.open', uri);
        }
    }

    private async _sendLastCommitMessage() {
        if (!this.gitService) return;
        const message = await this.gitService.getLastCommitMessage();
        this._view?.webview.postMessage({
            type: 'lastCommitMessage',
            message: message
        });
    }

    // Placeholder for AI commit message generation
    private async _generateCommitMessage() {
        // Implementation pending integration with AI service
        this._view?.webview.postMessage({
            type: 'aiGenerating',
            generating: true
        });
        
        // Simulate delay
        setTimeout(() => {
            this._view?.webview.postMessage({
                type: 'generatedCommitMessage',
                message: 'feat: AI generated commit message stub'
            });
            this._view?.webview.postMessage({
                type: 'aiGenerating',
                generating: false
            });
        }, 1000);
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
        this._view?.webview.postMessage({
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
        this._view?.webview.postMessage({
            type: 'stashFiles',
            index: index,
            files: files
        });
    }

    private async _showStashFileDiff(index: number, filePath: string) {
        // Construct URIs for diff
        // Left: stash@{index}^1 (Parent)
        // Right: stash@{index} (The stash) or just Read-only content
        
        const stashRef = `stash@{${index}}`;
        const leftRef = `${stashRef}^1`;
        
        const leftUri = vscode.Uri.parse(`idea-stash://load/left?${JSON.stringify({ref: leftRef, path: filePath})}`);
        const rightUri = vscode.Uri.parse(`idea-stash://load/right?${JSON.stringify({ref: stashRef, path: filePath})}`);

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


    private _getHtmlForWebview(webview: vscode.Webview) {
        // Use the new React build output
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'webview.js')
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'index.css')
        );

        // Keep codicons for icons if needed by React or loaded separately? 
        // The React app might bundle its own or use the one from node_modules.
        // Let's verify if `webview-ui` uses generic codicons CSS or bundles it.
        // Based on package.json, `webview-ui` deps include `@vscode/codicons`.
        // Vite usually bundles imported CSS. If `main.tsx` imports it, it's in index.css.
        // If not, we might need to include it.
        // Looking at `package.json` of root, `@vscode/codicons` is there. 
        // `webview-ui/package.json` (implied) likely has it too.
        // Let's assume standard Vite bundle handles it for now, typically `index.css` contains all styles.
        // However, standard VS Code webviews often load codicon.css explicitly if they use the font.
        // Let's include it just in case to ensure icons work if they rely on the global font class availability.
        const codiconUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css')
        );

        const nonce = this._getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
    <link href="${styleUri}" rel="stylesheet">
    <link href="${codiconUri}" rel="stylesheet">
    <title>Commit</title>
</head>
<body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    private _getNonce() {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}
