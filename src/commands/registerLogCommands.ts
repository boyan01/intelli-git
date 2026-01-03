import * as vscode from 'vscode';
import { GitService } from '../services/GitService';

export function registerLogCommands(
    context: vscode.ExtensionContext,
    gitService: GitService
) {
    const getCommitHash = (arg: any): string | undefined => {
        if (!arg) return undefined;
        if (arg.webviewSection === 'gitLogCommit' && arg.hash) return arg.hash;
        // Fallback or other contexts
        if (arg.hash) return arg.hash;
        return undefined;
    };

    const confirmAction = async (message: string, action: string) => {
        const result = await vscode.window.showWarningMessage(message, { modal: true }, action);
        return result === action;
    };

    // Reset Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.log.resetSoft', async (arg) => {
            const hash = getCommitHash(arg);
            if (!hash) return;
            if (await confirmAction(`Reset current branch to ${hash} (Soft)?\nChanges will be staged.`, 'Reset')) {
                try {
                    await gitService.reset('soft', hash);
                    vscode.window.showInformationMessage(`Soft reset successful.`);
                } catch (e: any) {
                    vscode.window.showErrorMessage(`Reset failed: ${e.message}`);
                }
            }
        }),
        vscode.commands.registerCommand('intelli-git.log.resetMixed', async (arg) => {
            const hash = getCommitHash(arg);
            if (!hash) return;
            if (await confirmAction(`Reset current branch to ${hash} (Mixed)?\nChanges will be unstaged.`, 'Reset')) {
                try {
                    await gitService.reset('mixed', hash);
                    vscode.window.showInformationMessage(`Mixed reset successful.`);
                } catch (e: any) {
                    vscode.window.showErrorMessage(`Reset failed: ${e.message}`);
                }
            }
        }),
        vscode.commands.registerCommand('intelli-git.log.resetHard', async (arg) => {
            const hash = getCommitHash(arg);
            if (!hash) return;
            if (await confirmAction(`Reset current branch to ${hash} (Hard)?\nALL LOCAL CHANGES WILL BE LOST.`, 'Reset Hard')) {
                try {
                    await gitService.reset('hard', hash);
                    vscode.window.showInformationMessage(`Hard reset successful.`);
                } catch (e: any) {
                    vscode.window.showErrorMessage(`Reset failed: ${e.message}`);
                }
            }
        })
    );

    // Checkout
    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.log.checkout', async (arg) => {
            const hash = getCommitHash(arg);
            if (!hash) return;
            if (await confirmAction(`Checkout commit ${hash}? You will be in detached HEAD state.`, 'Checkout')) {
                try {
                    await gitService.checkoutCommit(hash);
                    vscode.window.showInformationMessage(`Checked out ${hash}`);
                } catch (e: any) {
                    vscode.window.showErrorMessage(`Checkout failed: ${e.message}`);
                }
            }
        })
    );

    // Create Branch
    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.log.createBranch', async (arg) => {
            const hash = getCommitHash(arg);
            if (!hash) return;

            const branchName = await vscode.window.showInputBox({
                prompt: `Create new branch at ${hash}`,
                placeHolder: 'Branch name'
            });

            if (branchName) {
                try {
                    await gitService.createBranchFrom(branchName, hash);
                    vscode.window.showInformationMessage(`Created branch ${branchName} at ${hash}`);
                } catch (e: any) {
                    vscode.window.showErrorMessage(`Failed to create branch: ${e.message}`);
                }
            }
        })
    );

    // Cherry Pick
    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.log.cherryPick', async (arg) => {
            const hash = getCommitHash(arg);
            if (!hash) return;

            if (await confirmAction(`Cherry-pick commit ${hash}?`, 'Cherry-pick')) {
                try {
                    await gitService.cherryPick(hash);
                    vscode.window.showInformationMessage(`Cherry-picked ${hash}`);
                } catch (e: any) {
                    vscode.window.showErrorMessage(`Cherry-pick failed: ${e.message}`);
                }
            }
        })
    );

    // Revert
    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.log.revert', async (arg) => {
            const hash = getCommitHash(arg);
            if (!hash) return;

            if (await confirmAction(`Revert commit ${hash}?`, 'Revert')) {
                try {
                    await gitService.revert(hash);
                    vscode.window.showInformationMessage(`Reverted ${hash}`);
                } catch (e: any) {
                    vscode.window.showErrorMessage(`Revert failed: ${e.message}`);
                }
            }
        })
    );
}
