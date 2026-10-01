import * as path from 'path';
import * as vscode from 'vscode';

export function sanitizePatchFileBaseName(name: string): string {
    const sanitized = name
        .replace(/\.(patch|diff)$/i, '')
        .replace(/[<>:"/\\|?*]+/g, '-')
        .replace(/\s+/g, '-')
        .replace(/^-+|-+$/g, '');

    return sanitized || 'changes';
}

export function ensurePatchContent(patch: string): boolean {
    if (patch.trim()) {
        return true;
    }

    vscode.window.showInformationMessage(vscode.l10n.t('No changes to create patch from.'));
    return false;
}

export async function copyPatchToClipboard(patch: string): Promise<void> {
    if (!ensurePatchContent(patch)) {
        return;
    }

    await vscode.env.clipboard.writeText(patch);
    vscode.window.showInformationMessage(vscode.l10n.t('Patch copied to clipboard.'));
}

export async function savePatchToFile(
    patch: string,
    options: { workspaceRoot?: string; defaultBaseName: string }
): Promise<void> {
    if (!ensurePatchContent(patch)) {
        return;
    }

    const defaultFileName = `${sanitizePatchFileBaseName(options.defaultBaseName)}.patch`;
    const defaultUri = options.workspaceRoot
        ? vscode.Uri.file(path.join(options.workspaceRoot, defaultFileName))
        : undefined;

    const fileUri = await vscode.window.showSaveDialog({
        defaultUri,
        filters: { 'Patch Files': ['patch', 'diff'] },
        title: vscode.l10n.t('Save Patch'),
    });

    if (!fileUri) {
        return;
    }

    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(patch, 'utf8'));
    vscode.window.showInformationMessage(vscode.l10n.t('Patch saved to {0}', fileUri.fsPath));
}
