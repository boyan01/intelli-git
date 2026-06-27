import * as vscode from 'vscode';
import { GitService } from '../services/GitService';
import * as path from 'path';
import { createRevisionContentUri } from '../utils/repositoryContentUri';
import { copyPatchToClipboard, savePatchToFile } from '../utils/patchExport';

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

    const getPatch = async (arg: any) => {
        const data = getCommandArgs(arg);
        if (!data) return null;

        const patch = await gitService.getFileDiff(data.commitHash, data.path);
        const fileName = path.basename(data.path);
        const shortHash = data.commitHash.substring(0, 7);

        return {
            patch,
            defaultBaseName: `${fileName}-${shortHash}`
        };
    };

    // 1. Show Diff
    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.log.file.showDiff', async (arg) => {
            const data = getCommandArgs(arg);
            if (!data || !data.isFile) return;

            const leftRef = data.status?.startsWith('A') ? '' : (data.parentHash || `${data.commitHash}^`);
            const rightRef = data.status?.startsWith('D') ? '4b825dc642cb6eb9a060e54bf8d69288fbee4904' : data.commitHash;

            const repoPath = data.path;
            const leftUri = createRevisionContentUri(gitService, repoPath, { ref: leftRef, pathKind: 'repo' });
            const rightUri = createRevisionContentUri(gitService, repoPath, { ref: rightRef, pathKind: 'repo' });
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
            const repoPath = filePath;

            const revisionUri = createRevisionContentUri(gitService, repoPath, { ref: commitHash, pathKind: 'repo' });
            const localUri = vscode.Uri.file(path.join(gitService.getGitRoot(), repoPath));

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

            const repoPath = data.path;
            const revisionUri = createRevisionContentUri(gitService, repoPath, { ref: data.commitHash, pathKind: 'repo' });

            await vscode.window.showTextDocument(revisionUri, { preview: false });
        })
    );

    // 4. Revert Selected Changes (Reverse Patch)
    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.log.file.revertChanges', async (arg) => {
            const data = getCommandArgs(arg);
            if (!data) return;

            try {
                const repoPath = data.path;
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
                const repoPath = data.path;
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

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.log.file.createPatch.copy', async (arg) => {
            const result = await getPatch(arg);
            if (!result) return;

            await copyPatchToClipboard(result.patch);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('intelli-git.log.file.createPatch.save', async (arg) => {
            const result = await getPatch(arg);
            if (!result) return;

            await savePatchToFile(result.patch, {
                workspaceRoot: gitService.getWorkspaceRoot(),
                defaultBaseName: result.defaultBaseName
            });
        })
    );
}
