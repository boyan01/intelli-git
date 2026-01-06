import * as vscode from 'vscode';
import { CommitViewProvider, GitLogViewProvider, PushPanel, StashContentProvider, RevisionContentProvider } from './providers';
import { GitService } from './services/GitService';
import { ChangelistService } from './services/ChangelistService';
import { BranchStatusBar, GitLogStatusBar } from './ui';
import { registerStashCommands, registerNavigationCommands, registerBranchCommands, registerLogCommands } from './commands';
import { initLogger, log } from './utils/logger';

export function activate(context: vscode.ExtensionContext) {
    initLogger(context);
    log('Intelli Git is now active!');

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (!workspaceRoot) {
        vscode.window.showWarningMessage('Intelli Git: No workspace opened.');
        return;
    }

    // Initialize services
    const gitService = new GitService(workspaceRoot);
    const changelistService = new ChangelistService(context);

    // Initialize providers
    const providerOptions = {
        extensionUri: context.extensionUri,
        context,
        gitService,
        changelistService
    };
    const provider = new CommitViewProvider(providerOptions);
    const gitLogProvider = new GitLogViewProvider(providerOptions);
    const branchStatusBar = new BranchStatusBar(gitService);
    const gitLogStatusBar = new GitLogStatusBar(gitService);
    const stashContentProvider = new StashContentProvider(gitService);
    const revisionContentProvider = new RevisionContentProvider(gitService);

    // Register content providers
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider('intelli-git-stash', stashContentProvider)
    );
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider('intelli-git-revision', revisionContentProvider)
    );

    // Register webview providers
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(CommitViewProvider.viewType, provider)
    );
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(GitLogViewProvider.viewType, gitLogProvider)
    );

    // Register commands
    registerStashCommands(context, gitService, provider);
    registerNavigationCommands(context, gitService, branchStatusBar, gitLogProvider);
    registerBranchCommands(context, gitService, provider);
    registerLogCommands(context, gitService);

    context.subscriptions.push(branchStatusBar);
    context.subscriptions.push(gitLogStatusBar);

    // File watcher for auto-refresh
    const watcher = vscode.workspace.createFileSystemWatcher('**/*');
    let refreshTimeout: NodeJS.Timeout | undefined;

    const triggerRefresh = (uri?: vscode.Uri) => {
        if (uri && (/\/\.git\//.test(uri.path) || uri.path.endsWith('/.git'))) {
            return;
        }

        if (refreshTimeout) {
            clearTimeout(refreshTimeout);
        }
        refreshTimeout = setTimeout(() => {
            provider.refresh();
            branchStatusBar.update();
            gitLogStatusBar.update();
        }, 200);
    };

    watcher.onDidChange(triggerRefresh);
    watcher.onDidCreate(triggerRefresh);
    watcher.onDidDelete(triggerRefresh);

    context.subscriptions.push(watcher);

    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            branchStatusBar.update();
            gitLogStatusBar.update();
        })
    );
}

export function deactivate() { }
