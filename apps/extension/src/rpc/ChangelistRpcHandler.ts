import * as vscode from 'vscode';
import type {
    ChangelistInfo,
    ChangelistMode,
    ChangelistMoveRequest,
    FileReferenceInput,
    RepositoryFileReference,
} from '@shared/messages';
import { i18n } from '../utils/i18n';
import type { ChangelistStateService } from '../services/ChangelistStateService';
import type { ChangelistOperations } from '../operations/ChangelistOperations';

export class ChangelistRpcHandler {
    constructor(
        private readonly getOperations: (repoPath?: string) => ChangelistOperations | undefined,
        private readonly getChangelistStateService: (repoPath?: string) => ChangelistStateService | undefined
    ) {}

    private normalizeFileReference(input: FileReferenceInput): RepositoryFileReference {
        return typeof input === 'object' && input !== null
            ? { repoPath: input.repoPath, path: input.path }
            : { path: input };
    }

    private groupFileReferences(inputs: FileReferenceInput[]): Map<string | undefined, string[]> {
        const grouped = new Map<string | undefined, Set<string>>();
        for (const input of inputs) {
            const ref = this.normalizeFileReference(input);
            const paths = grouped.get(ref.repoPath) || new Set<string>();
            paths.add(ref.path);
            grouped.set(ref.repoPath, paths);
        }

        return new Map(Array.from(grouped.entries()).map(([repoPath, paths]) => [repoPath, Array.from(paths)]));
    }

    markHunkInactive = async (params: { path: string; repoPath?: string; hunkId: string }): Promise<void> => {
        await this.getOperations(params.repoPath)?.markHunksInactive(params.path, [params.hunkId]);
    };

    markHunkActive = async (params: { path: string; repoPath?: string; hunkId: string }): Promise<void> => {
        await this.getOperations(params.repoPath)?.markHunksActive(params.path, [params.hunkId]);
    };

    markFilesInactive = async (paths: FileReferenceInput[]): Promise<void> => {
        for (const [repoPath, repoPaths] of this.groupFileReferences(paths)) {
            await this.getOperations(repoPath)?.markFilesInactive(repoPaths);
        }
    };

    markFilesActive = async (paths: FileReferenceInput[]): Promise<void> => {
        for (const [repoPath, repoPaths] of this.groupFileReferences(paths)) {
            await this.getOperations(repoPath)?.markFilesActive(repoPaths);
        }
    };

    setChangelistMode = async (mode: ChangelistMode): Promise<void> => {
        await this.getOperations()?.setMode(mode);
    };

    createChangelist = async (name?: string): Promise<ChangelistInfo | null> => {
        const changelistName = (
            name ||
            (await vscode.window.showInputBox({
                prompt: i18n.t('extension.enterChangelistName'),
                value: i18n.t('Changes'),
            }))
        )?.trim();

        if (!changelistName) {
            return null;
        }

        return (await this.getOperations()?.createList(changelistName)) || null;
    };

    renameChangelist = async (params: { id: string; name?: string }): Promise<ChangelistInfo | null> => {
        const current = this.getChangelistStateService()
            ?.getState()
            .lists.find((list) => list.id === params.id);
        if (!current) {
            return null;
        }

        const changelistName = (
            params.name ||
            (await vscode.window.showInputBox({
                prompt: i18n.t('extension.enterChangelistName'),
                value: current.name,
            }))
        )?.trim();

        if (!changelistName) {
            return null;
        }

        return (await this.getOperations()?.renameList(params.id, changelistName)) || null;
    };

    deleteChangelist = async (id: string): Promise<void> => {
        const service = this.getChangelistStateService();
        const target = service?.getState().lists.find((list) => list.id === id);
        if (!target) {
            return;
        }

        const itemCount = service?.getListItemCount(id) || 0;
        if (itemCount > 0) {
            const confirmed = await vscode.window.showWarningMessage(
                i18n.t('extension.changelistNotEmpty', target.name),
                { modal: true },
                i18n.t('Delete')
            );

            if (confirmed !== i18n.t('Delete')) {
                return;
            }
        }

        await this.getOperations()?.deleteList(id);
    };

    setActiveChangelist = async (id: string): Promise<void> => {
        await this.getOperations()?.setActiveList(id);
    };

    moveChangesToChangelist = async (params: ChangelistMoveRequest): Promise<void> => {
        await this.getOperations(params.repoPath)?.moveChangesToChangelist(params);
    };

    moveFilesToChangelist = async (params: { paths: string[]; targetListId: string }): Promise<void> => {
        await this.getOperations()?.moveChangesToChangelist({
            targetListId: params.targetListId,
            paths: params.paths,
        });
    };

    moveHunksToChangelist = async (params: {
        path: string;
        hunkIds: string[];
        targetListId: string;
    }): Promise<void> => {
        await this.getOperations()?.moveChangesToChangelist({
            targetListId: params.targetListId,
            hunksByPath: { [params.path]: params.hunkIds },
        });
    };
}
