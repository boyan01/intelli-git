import * as vscode from 'vscode';
import { GitService, FileStatus } from './GitService';

export class CommitViewProvider implements vscode.WebviewViewProvider {

    public static readonly viewType = 'ideaCommitView';
    private _view?: vscode.WebviewView;
    private gitService?: GitService;

    constructor(private readonly _extensionUri: vscode.Uri) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            this.gitService = new GitService(workspaceFolders[0].uri.fsPath);
        }

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (data) => {
            if (!this.gitService) {
                return;
            }

            switch (data.type) {
                case 'refresh':
                    this.refresh();
                    break;
                case 'commit':
                    await this._handleCommit(data.message, data.amend);
                    break;
                case 'commitAndPush':
                    await this._handleCommitAndPush(data.message, data.amend);
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
                    await this._handleApplyStash(data.index);
                    break;
                case 'popStash':
                    await this._handlePopStash(data.index);
                    break;
                case 'dropStash':
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
            }
        });

        this.refresh();
    }

    private async _handleCommit(message: string, amend: boolean = false) {
        try {
            if (amend) {
                await this.gitService!.commitAmend(message);
            } else {
                await this.gitService!.commit(message);
            }
            vscode.window.showInformationMessage('提交成功!');
            this.refresh();
            this._view?.webview.postMessage({ type: 'clearMessage' });
        } catch (e) {
            vscode.window.showErrorMessage(`提交失败: ${e}`);
        }
    }

    private async _handleCommitAndPush(message: string, amend: boolean = false) {
        try {
            if (amend) {
                await this.gitService!.commitAmend(message);
            } else {
                await this.gitService!.commit(message);
            }
            vscode.window.showInformationMessage('提交成功!');
            this.refresh();
            this._view?.webview.postMessage({ type: 'clearMessage' });
            // Open push panel
            vscode.commands.executeCommand('idea-commit-panel.push');
        } catch (e) {
            vscode.window.showErrorMessage(`提交失败: ${e}`);
        }
    }

    private async _sendLastCommitMessage() {
        try {
            const message = await this.gitService!.getLastCommitMessage();
            this._view?.webview.postMessage({ type: 'lastCommitMessage', message });
        } catch (e) {
            console.error('Failed to get last commit message:', e);
        }
    }

    private async _generateCommitMessage() {
        try {
            // Get diff of staged changes
            const diff = await this.gitService!.getStagedDiff();
            if (!diff) {
                vscode.window.showWarningMessage('没有已暂存的更改');
                return;
            }

            // Try to use VS Code Language Model API
            const models = await vscode.lm.selectChatModels({
                vendor: 'copilot',
                family: 'gpt-4o'
            });

            if (models.length === 0) {
                vscode.window.showErrorMessage('未找到可用的 AI 模型，请确保已安装 GitHub Copilot');
                return;
            }

            const model = models[0];
            const messages = [
                vscode.LanguageModelChatMessage.User(
                    `Based on the following git diff, generate a concise and descriptive commit message in conventional commits format (e.g., feat:, fix:, docs:, etc.). Only output the commit message, nothing else.\n\nDiff:\n${diff.substring(0, 8000)}`
                )
            ];

            this._view?.webview.postMessage({ type: 'aiGenerating', generating: true });

            const response = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);
            
            let commitMessage = '';
            for await (const chunk of response.text) {
                commitMessage += chunk;
            }

            this._view?.webview.postMessage({ 
                type: 'generatedCommitMessage', 
                message: commitMessage.trim() 
            });
        } catch (e) {
            console.error('Failed to generate commit message:', e);
            vscode.window.showErrorMessage(`AI 生成失败: ${e}`);
        } finally {
            this._view?.webview.postMessage({ type: 'aiGenerating', generating: false });
        }
    }

    private async _handleSwitchBranch(branch: string) {
        try {
            await this.gitService!.switchBranch(branch);
            this.refresh();
        } catch (e) {
            vscode.window.showErrorMessage(`Failed to switch branch: ${e}`);
        }
    }

    private async _handleStash(files?: string[]) {
        try {
            const hasSelectedFiles = files && files.length > 0;
            const prompt = hasSelectedFiles 
                ? `贮藏 ${files.length} 个选中文件的信息（可选）`
                : '贮藏所有更改的信息（可选）';
            
            const message = await vscode.window.showInputBox({
                prompt,
                placeHolder: 'Stash message'
            });
            
            // User cancelled
            if (message === undefined) {
                return;
            }
            
            await this.gitService!.stash(message || undefined, files);
            const filesInfo = hasSelectedFiles ? `${files.length} 个文件` : '所有更改';
            vscode.window.showInformationMessage(`已贮藏 ${filesInfo}`);
            this.refresh();
        } catch (e) {
            vscode.window.showErrorMessage(`贮藏失败: ${e}`);
        }
    }

    private async _handleRollback(files: string[]) {
        if (!files || files.length === 0) {
            vscode.window.showWarningMessage('没有选择要回滚的文件');
            return;
        }

        const confirm = await vscode.window.showWarningMessage(
            `确定要回滚 ${files.length} 个文件的更改吗？此操作不可撤销！`,
            { modal: true },
            '确定'
        );

        if (confirm !== '确定') {
            return;
        }

        try {
            await this.gitService!.rollbackFiles(files);
            vscode.window.showInformationMessage(`已回滚 ${files.length} 个文件`);
            this.refresh();
        } catch (e) {
            vscode.window.showErrorMessage(`回滚失败: ${e}`);
        }
    }

    private async _sendChangedFiles() {
        try {
            const files = await this.gitService!.getStatus();
            const changedFiles = files.filter(f => !f.staged).map(f => f.path);
            this._view?.webview.postMessage({ type: 'changedFiles', files: changedFiles });
        } catch (e) {
            console.error('Failed to get changed files:', e);
        }
    }

    private async _sendStashList() {
        try {
            const stashList = await this.gitService!.getStashList();
            console.log('Stash list:', JSON.stringify(stashList));
            this._view?.webview.postMessage({ type: 'stashList', stashList });
        } catch (e) {
            console.error('Failed to get stash list:', e);
        }
    }

    private async _handleApplyStash(index: number) {
        try {
            await this.gitService!.applyStash(index);
            vscode.window.showInformationMessage('已应用贮藏');
            this.refresh();
            this._sendStashList();
        } catch (e) {
            vscode.window.showErrorMessage(`应用贮藏失败: ${e}`);
        }
    }

    private async _handlePopStash(index: number) {
        try {
            await this.gitService!.popStash(index);
            vscode.window.showInformationMessage('已弹出贮藏');
            this.refresh();
            this._sendStashList();
        } catch (e) {
            vscode.window.showErrorMessage(`弹出贮藏失败: ${e}`);
        }
    }

    private async _handleDropStash(index: number) {
        const confirm = await vscode.window.showWarningMessage(
            '确定要删除此贮藏吗？此操作不可撤销！',
            { modal: true },
            '确定'
        );

        if (confirm !== '确定') {
            return;
        }

        try {
            await this.gitService!.dropStash(index);
            vscode.window.showInformationMessage('已删除贮藏');
            this._sendStashList();
        } catch (e) {
            vscode.window.showErrorMessage(`删除贮藏失败: ${e}`);
        }
    }

    private async _sendStashFiles(index: number) {
        try {
            const files = await this.gitService!.getStashFiles(index);
            this._view?.webview.postMessage({ type: 'stashFiles', index, files });
        } catch (e) {
            console.error('Failed to get stash files:', e);
        }
    }

    private async _showStashFileDiff(index: number, filePath: string) {
        try {
            const diff = await this.gitService!.getStashFileDiff(index, filePath);
            if (diff) {
                const doc = await vscode.workspace.openTextDocument({
                    content: diff,
                    language: 'diff'
                });
                await vscode.window.showTextDocument(doc, { preview: true });
            }
        } catch (e) {
            vscode.window.showErrorMessage(`获取 diff 失败: ${e}`);
        }
    }

    private async _showStashActions(index: number) {
        const actions = [
            { label: '$(check) 弹出', description: '应用贮藏并删除', action: 'pop' },
            { label: '$(arrow-up) 应用', description: '应用贮藏但保留', action: 'apply' },
            { label: '$(trash) 删除', description: '删除贮藏', action: 'drop' }
        ];

        const selected = await vscode.window.showQuickPick(actions, {
            placeHolder: `选择对 stash@{${index}} 的操作`
        });

        if (!selected) return;

        switch (selected.action) {
            case 'pop':
                await this._handlePopStash(index);
                break;
            case 'apply':
                await this._handleApplyStash(index);
                break;
            case 'drop':
                await this._handleDropStash(index);
                break;
        }
    }

    private async _handleRollbackWithPick() {
        try {
            const files = await this.gitService!.getStatus();
            const changedFiles = files.filter(f => !f.staged);

            if (changedFiles.length === 0) {
                vscode.window.showInformationMessage('没有可回滚的文件');
                return;
            }

            const items = changedFiles.map(f => ({
                label: f.path,
                description: f.status,
                picked: false
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: '选择要回滚的文件',
                canPickMany: true
            });

            if (!selected || selected.length === 0) {
                return;
            }

            const filePaths = selected.map(s => s.label);
            await this._handleRollback(filePaths);
        } catch (e) {
            vscode.window.showErrorMessage(`获取文件列表失败: ${e}`);
        }
    }

    private async _handleUpdateProject() {
        try {
            await this.gitService!.pull();
            vscode.window.showInformationMessage('Project updated.');
            this.refresh();
        } catch (e) {
            vscode.window.showErrorMessage(`Update failed: ${e}`);
        }
    }

    private _handleOpenFile(filePath: string) {
        if (!this.gitService) {
            return;
        }
        const workspaceRoot = this.gitService.getWorkspaceRoot();
        const uri = vscode.Uri.file(`${workspaceRoot}/${filePath}`);
        vscode.commands.executeCommand('vscode.open', uri);
    }

    public async refresh() {
        if (!this._view || !this.gitService) {
            return;
        }

        const files = await this.gitService.getStatus();
        const branches = await this.gitService.getBranches();

        this._view.webview.postMessage({
            type: 'update',
            files,
            branches
        });
    }

    public switchTab(tab: 'commit' | 'stash') {
        if (this._view) {
            this._view.webview.postMessage({
                type: 'switchTab',
                tab: tab
            });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js')
        );
        const styleResetUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'reset.css')
        );
        const styleVSCodeUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'vscode.css')
        );
        const styleMainUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css')
        );
        const codiconUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css')
        );
        const menuCssUri = webview.asWebviewUri(
             vscode.Uri.joinPath(this._extensionUri, 'media', 'menu.css')
        );
        const menuJsUri = webview.asWebviewUri(
             vscode.Uri.joinPath(this._extensionUri, 'media', 'menu.js')
        );

        const nonce = this._getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
    <link href="${styleResetUri}" rel="stylesheet">
    <link href="${styleVSCodeUri}" rel="stylesheet">
    <link href="${codiconUri}" rel="stylesheet">
    <link href="${menuCssUri}" rel="stylesheet">
    <link href="${styleMainUri}" rel="stylesheet">
    <title>Commit</title>
</head>
<body>
    <div class="commit-panel">
        <!-- Header Tabs -->
        <div class="header-tabs">
            <div class="tabs-left">
                <button class="tab active" data-tab="commit">提交</button>
                <button class="tab" data-tab="stash">贮藏</button>
            </div>
            <div class="tabs-right">
                <button class="icon-btn" title="More Actions">
                    <i class="codicon codicon-ellipsis"></i>
                </button>
            </div>
        </div>

        <!-- Commit Tab Content -->
        <div id="commit-tab-content" class="tab-content active">
            <!-- File Actions Toolbar -->
            <div class="file-toolbar">
                <div class="toolbar-left">
                    <button id="refresh-btn" class="icon-btn" title="刷新">
                        <i class="codicon codicon-sync"></i>
                    </button>
                    <button id="rollback-btn" class="icon-btn" title="回滚选中的更改">
                        <i class="codicon codicon-discard"></i>
                    </button>
                    <button id="stash-btn" class="icon-btn" title="贮藏选中的文件">
                        <i class="codicon codicon-archive"></i>
                    </button>
                    <button id="view-options-btn" class="icon-btn" title="视图选项">
                        <i class="codicon codicon-list-tree"></i>
                    </button>
                    <button id="expand-all-btn" class="icon-btn" title="全部展开">
                        <i class="codicon codicon-expand-all"></i>
                    </button>
                    <button id="collapse-all-btn" class="icon-btn" title="全部收起">
                        <i class="codicon codicon-collapse-all"></i>
                    </button>
                </div>
            </div>

            <!-- Change List Tree -->
            <div id="file-list" class="file-list"></div>

            <!-- Commit Message Area -->
            <div class="commit-section">
                <div class="commit-toolbar">
                    <label class="amend-label">
                        <input type="checkbox" id="amend-checkbox">
                        <span>修正(M)</span>
                    </label>
                </div>
                <textarea id="commit-msg" placeholder="提交信息" rows="4"></textarea>
            </div>

            <!-- Footer Actions -->
            <div class="footer-actions">
                <div class="actions-left">
                    <button id="commit-btn" class="btn btn-primary">提交(I)</button>
                    <button id="commit-push-btn" class="btn btn-secondary">提交并推送(P)...</button>
                </div>
                <div class="actions-right">
                    <button id="settings-btn" class="icon-btn" title="设置">
                        <i class="codicon codicon-settings-gear"></i>
                    </button>
                </div>
            </div>
        </div>

        <!-- Stash Tab Content -->
        <div id="stash-tab-content" class="tab-content">

            <div id="stash-list" class="stash-list"></div>
        </div>
    </div>

    <script nonce="${nonce}" src="${menuJsUri}"></script>
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
