import * as vscode from 'vscode';
import { CommitViewProvider, GitLogViewProvider, StashContentProvider, RevisionContentProvider } from './providers';
import { GitService } from './services/GitService';
import { createGitWatcher } from './services/GitRepositoryWatcher';
import { ChangelistStateService } from './services/ChangelistStateService';
import { InactiveChangesService } from './services/InactiveChangesService';
import { BranchStatusBar, GitLogStatusBar } from './ui';
import { registerStashCommands, registerNavigationCommands, registerBranchCommands, registerLogCommands, registerLogFileCommands, registerChangelistCommands, registerAiCommands } from './commands';
import { logger } from './utils/logger';

export async function activate(context: vscode.ExtensionContext) {
    logger.initLogger(context);
    logger.info('Intelli Git is now active!');

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (!workspaceRoot) {
        logger.info('Intelli Git: No workspace opened.');
        return;
    }

    // Initialize services
    const inactiveChangesService = new InactiveChangesService(context);
    const changelistStateService = new ChangelistStateService(context);
    const gitService = await GitService.create(workspaceRoot, inactiveChangesService, changelistStateService);

    // Initialize providers
    const providerOptions = {
        extensionUri: context.extensionUri,
        context,
        gitService,
        inactiveChangesService,
        changelistStateService
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
    registerNavigationCommands(context, gitService, branchStatusBar, gitLogProvider, provider);
    registerBranchCommands(context, gitService, provider);
    registerLogCommands(context, gitService);
    registerLogFileCommands(context, gitService);
    registerChangelistCommands(context, gitService, inactiveChangesService, changelistStateService, provider);
    registerAiCommands(context);

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

    // Watch for diagnostic changes to update file error status in changelist
    context.subscriptions.push(
        vscode.languages.onDidChangeDiagnostics(() => {
            triggerRefresh();
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('intelli-git.changelist.mode')) {
                triggerRefresh();
            }
        })
    );
}

export function deactivate() { }
