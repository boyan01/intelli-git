import * as vscode from 'vscode';
import type { ChangelistInfo, ChangelistMode, ChangelistMoveRequest } from '@shared/messages';
import { i18n } from '../utils/i18n';
import type { ChangelistStateService } from '../services/ChangelistStateService';
import type { ChangelistOperations } from '../operations/ChangelistOperations';

export class ChangelistRpcHandler {
    constructor(
        private readonly getOperations: () => ChangelistOperations | undefined,
        private readonly getChangelistStateService: () => ChangelistStateService | undefined
    ) { }

    markHunkInactive = async (params: { path: string; hunkId: string }): Promise<void> => {
        await this.getOperations()?.markHunksInactive(params.path, [params.hunkId]);
    };

    markHunkActive = async (params: { path: string; hunkId: string }): Promise<void> => {
        await this.getOperations()?.markHunksActive(params.path, [params.hunkId]);
    };

    markFilesInactive = async (paths: string[]): Promise<void> => {
        await this.getOperations()?.markFilesInactive(paths);
    };

    markFilesActive = async (paths: string[]): Promise<void> => {
        await this.getOperations()?.markFilesActive(paths);
    };

    setChangelistMode = async (mode: ChangelistMode): Promise<void> => {
        await this.getOperations()?.setMode(mode);
    };

    createChangelist = async (name?: string): Promise<ChangelistInfo | null> => {
        const changelistName = (name || await vscode.window.showInputBox({
            prompt: i18n.t('extension.enterChangelistName'),
            value: i18n.t('Changes')
        }))?.trim();

        if (!changelistName) {
            return null;
        }

        return await this.getOperations()?.createList(changelistName) || null;
    };

    renameChangelist = async (params: { id: string; name?: string }): Promise<ChangelistInfo | null> => {
        const current = this.getChangelistStateService()?.getState().lists.find(list => list.id === params.id);
        if (!current) {
            return null;
        }

        const changelistName = (params.name || await vscode.window.showInputBox({
            prompt: i18n.t('extension.enterChangelistName'),
            value: current.name
        }))?.trim();

        if (!changelistName) {
            return null;
        }

        return await this.getOperations()?.renameList(params.id, changelistName) || null;
    };

    deleteChangelist = async (id: string): Promise<void> => {
        const service = this.getChangelistStateService();
        const target = service?.getState().lists.find(list => list.id === id);
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
        await this.getOperations()?.moveChangesToChangelist(params);
    };

    moveFilesToChangelist = async (params: { paths: string[]; targetListId: string }): Promise<void> => {
        await this.getOperations()?.moveChangesToChangelist({
            targetListId: params.targetListId,
            paths: params.paths
        });
    };

    moveHunksToChangelist = async (params: { path: string; hunkIds: string[]; targetListId: string }): Promise<void> => {
        await this.getOperations()?.moveChangesToChangelist({
            targetListId: params.targetListId,
            hunksByPath: { [params.path]: params.hunkIds }
        });
    };
}
