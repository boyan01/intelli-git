import * as vscode from 'vscode';
import { GitService } from '../services/GitService';
import * as path from 'path';

export function registerLogFileCommands(
    context: vscode.ExtensionContext,
    gitService: GitService
) {
    const getCommandArgs = (arg: any) => {
        if (!arg || arg.webviewSection !== 'gitLogCommitFile') return null;
        return {
            path: arg.path,
            status: arg.status,
            isFile: !!arg.isFile,
            commitHash: arg.commitHash,
            parentHash: arg.parentHash
        };
    };

    // 1. Show Diff
    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.log.file.showDiff', async (arg) => {
            const data = getCommandArgs(arg);
            if (!data || !data.isFile) return;

            const leftRef = data.status?.startsWith('A') ? '' : (data.parentHash || `${data.commitHash}^`);
            const rightRef = data.status?.startsWith('D') ? '4b825dc642cb6eb9a060e54bf8d69288fbee4904' : data.commitHash;

            const repoPath = gitService.toRepoPath(data.path);
            const leftUri = vscode.Uri.parse(`intelli-git-revision://load/${repoPath}?${JSON.stringify({ ref: leftRef })}`);
            const rightUri = vscode.Uri.parse(`intelli-git-revision://load/${repoPath}?${JSON.stringify({ ref: rightRef })}`);
            const title = `${path.basename(data.path)} (${leftRef.substring(0, 7) || 'None'} ↔ ${rightRef.substring(0, 7)})`;

            await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
        })
    );

    // 2. Compare with Local
    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.log.file.compareWithLocal', async (arg) => {
            const data = getCommandArgs(arg);
            if (!data || !data.isFile) return;

            const commitHash = data.commitHash;
            const filePath = data.path;
            const repoPath = gitService.toRepoPath(filePath);

            const revisionUri = vscode.Uri.parse(`intelli-git-revision://load/${repoPath}?${JSON.stringify({ ref: commitHash })}`);
            const localUri = vscode.Uri.file(path.join(gitService.getWorkspaceRoot(), filePath));

            const fileName = path.basename(filePath);
            const title = `${fileName} (${commitHash.substring(0, 7)}) ↔ Local`;

            await vscode.commands.executeCommand('vscode.diff', revisionUri, localUri, title);
        })
    );

    // 3. Open Repository Version
    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.log.file.openRepositoryVersion', async (arg) => {
            const data = getCommandArgs(arg);
            if (!data || !data.isFile || data.status === 'D') return;

            const repoPath = gitService.toRepoPath(data.path);
            const revisionUri = vscode.Uri.parse(`intelli-git-revision://load/${repoPath}?${JSON.stringify({ ref: data.commitHash })}`);

            await vscode.window.showTextDocument(revisionUri, { preview: false });
        })
    );

    // 4. Revert Selected Changes (Reverse Patch)
    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.log.file.revertChanges', async (arg) => {
            const data = getCommandArgs(arg);
            if (!data) return;

            try {
                const repoPath = gitService.toRepoPath(data.path);
                const patch = await gitService.getFileDiff(data.commitHash, repoPath);

                if (!patch) {
                    vscode.window.showInformationMessage(vscode.l10n.t('No changes to revert.'));
                    return;
                }

                await gitService.applyPatch(patch, true); // Reverse apply
                vscode.window.showInformationMessage(vscode.l10n.t('Changes reverted successfully.'));
            } catch (e: any) {
                vscode.window.showErrorMessage(vscode.l10n.t('Failed to revert changes: {0}', e.message));
            }
        })
    );

    // 5. Cherry-pick Selected Changes (Apply Patch)
    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.log.file.cherryPickChanges', async (arg) => {
            const data = getCommandArgs(arg);
            if (!data) return;

            try {
                const repoPath = gitService.toRepoPath(data.path);
                const patch = await gitService.getFileDiff(data.commitHash, repoPath);

                if (!patch) {
                    vscode.window.showInformationMessage(vscode.l10n.t('No changes to cherry-pick.'));
                    return;
                }

                await gitService.applyPatch(patch, false); // Forward apply
                vscode.window.showInformationMessage(vscode.l10n.t('Changes cherry-picked successfully.'));
            } catch (e: any) {
                vscode.window.showErrorMessage(vscode.l10n.t('Failed to cherry-pick changes: {0}', e.message));
            }
        })
    );

    // 6. Create Patch
    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.log.file.createPatch', async (arg) => {
            const data = getCommandArgs(arg);
            if (!data) return;

            const repoPath = gitService.toRepoPath(data.path);
            const patch = await gitService.getFileDiff(data.commitHash, repoPath);

            if (!patch) {
                vscode.window.showInformationMessage(vscode.l10n.t('No changes to create patch from.'));
                return;
            }

            const options = [
                { label: vscode.l10n.t('Copy to Clipboard'), id: 'clipboard' },
                { label: vscode.l10n.t('Save to File...'), id: 'file' }
            ];

            const selected = await vscode.window.showQuickPick(options, {
                placeHolder: vscode.l10n.t('Choose how to create the patch')
            });

            if (!selected) return;

            if (selected.id === 'clipboard') {
                await vscode.env.clipboard.writeText(patch);
                vscode.window.showInformationMessage(vscode.l10n.t('Patch copied to clipboard.'));
            } else {
                const fileName = path.basename(data.path);
                const shortHash = data.commitHash.substring(0, 7);
                const defaultUri = vscode.Uri.file(path.join(gitService.getWorkspaceRoot(), `${fileName}-${shortHash}.patch`));

                const fileUri = await vscode.window.showSaveDialog({
                    defaultUri,
                    filters: { 'Patch Files': ['patch', 'diff'] },
                    title: vscode.l10n.t('Save Patch')
                });

                if (fileUri) {
                    const fs = await import('fs');
                    fs.writeFileSync(fileUri.fsPath, patch);
                    vscode.window.showInformationMessage(vscode.l10n.t('Patch saved to {0}', fileUri.fsPath));
                }
            }
        })
    );
}
