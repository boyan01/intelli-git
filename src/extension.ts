import * as vscode from 'vscode';
import { CommitViewProvider, GitLogViewProvider, PushPanel, StashContentProvider, RevisionContentProvider } from './providers';
import { GitService } from './services/GitService';
import { createGitWatcher } from './services/GitRepositoryWatcher';
import { ChangelistService } from './services/ChangelistService';
import { BranchStatusBar, GitLogStatusBar } from './ui';
import { registerStashCommands, registerNavigationCommands, registerBranchCommands, registerLogCommands, registerChangelistCommands } from './commands';
import { initLogger, log } from './utils/logger';

export function activate(context: vscode.ExtensionContext) {
    initLogger(context);
    log('Intelli Git is now active!');

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (!workspaceRoot) {
        log('Intelli Git: No workspace opened.');
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
    registerChangelistCommands(context, gitService, changelistService, provider);

    context.subscriptions.push(branchStatusBar);
    context.subscriptions.push(gitLogStatusBar);

    // Register Author Context Menu Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.copyAuthorEmail', async (args) => {
            if (args && args.email) {
                await vscode.env.clipboard.writeText(args.email);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.sendAuthorEmail', (args) => {
            if (args && args.email) {
                vscode.env.openExternal(vscode.Uri.parse(`mailto:${args.email}`));
            }
        })
    );

    const triggerRefresh = () => {
        provider.rpc?.refresh();
        gitLogProvider.rpc?.refresh();
        branchStatusBar.update();
        gitLogStatusBar.update();
    };

    // Git watcher: uses VS Code Git extension API, falls back to FileSystemWatcher
    createGitWatcher(context, workspaceRoot).then(watcher => {
        context.subscriptions.push(watcher.onChange(triggerRefresh));
        context.subscriptions.push(watcher);
    });

    // GitService triggers refresh on Git state changes (commit, reset, reword, etc.)
    context.subscriptions.push(gitService.onDidChange(triggerRefresh));
    context.subscriptions.push(gitService);

    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            branchStatusBar.update();
            gitLogStatusBar.update();
        })
    );
}

export function deactivate() { }
