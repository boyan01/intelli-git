
import * as vscode from 'vscode';
import { FileStatus } from './GitService';

export interface Changelist {
    id: string;
    name: string;
    description?: string;
    isDefault: boolean;
    files: string[]; // Relative paths
}

export class ChangelistService {
    private static readonly STORAGE_KEY = 'ideaCommitPanel.changelists';
    private _changelists: Changelist[] = [];

    constructor(private context: vscode.ExtensionContext) {
        this._loadState();
    }

    private _loadState() {
        const saved = this.context.workspaceState.get<Changelist[]>(ChangelistService.STORAGE_KEY);
        if (saved && saved.length > 0) {
            this._changelists = saved;
        } else {
            // Initialize default changelist
            this._changelists = [{
                id: 'default',
                name: 'Default Changelist',
                isDefault: true,
                files: []
            }];
            this._saveState();
        }
    }

    private async _saveState() {
        await this.context.workspaceState.update(ChangelistService.STORAGE_KEY, this._changelists);
    }

    public getChangelists(): Changelist[] {
        return this._changelists;
    }

    public getChangelistById(id: string): Changelist | undefined {
        return this._changelists.find(c => c.id === id);
    }

    public getDefaultChangelist(): Changelist {
        return this._changelists.find(c => c.isDefault) || this._changelists[0];
    }

    public async createChangelist(name: string): Promise<string> {
        const id = this._generateId();
        const newChangelist: Changelist = {
            id,
            name,
            isDefault: false,
            files: []
        };
        this._changelists.push(newChangelist);
        await this._saveState();
        return id;
    }

    public async removeChangelist(id: string): Promise<void> {
        const index = this._changelists.findIndex(c => c.id === id);
        if (index === -1) return;

        const toRemove = this._changelists[index];
        if (toRemove.isDefault) {
            vscode.window.showErrorMessage('Cannot remove default changelist.');
            return;
        }

        // Move files to default changelist
        const defaultList = this.getDefaultChangelist();
        defaultList.files.push(...toRemove.files);

        this._changelists.splice(index, 1);
        await this._saveState();
    }

    public async renameChangelist(id: string, newName: string): Promise<void> {
        const list = this.getChangelistById(id);
        if (list) {
            list.name = newName;
            await this._saveState();
        }
    }

    public async moveFiles(files: string[], targetListId: string): Promise<void> {
        const targetList = this.getChangelistById(targetListId);
        if (!targetList) return;

        // Remove files from all other lists
        this._changelists.forEach(list => {
            if (list.id !== targetListId) {
                list.files = list.files.filter(f => !files.includes(f));
            }
        });

        // Add to target list (avoid duplicates)
        files.forEach(f => {
            if (!targetList.files.includes(f)) {
                targetList.files.push(f);
            }
        });

        await this._saveState();
    }


    public async setActiveChangelist(id: string): Promise<void> {
        // Implementation for active changelist if needed in future
    }

    public getChangelistForFile(filePath: string): string {
        for (const list of this._changelists) {
            if (list.files.includes(filePath)) {
                return list.id;
            }
        }
        return this.getDefaultChangelist().id;
    }

    public syncWithStatus(statusFiles: FileStatus[]) {
        const allStatusPaths = new Set(statusFiles.map(f => f.path));

        // 1. Remove files from changelists that are no longer in status
        this._changelists.forEach(list => {
            list.files = list.files.filter(f => allStatusPaths.has(f));
        });

        // 2. Find files not in any changelist
        const allTrackedFiles = new Set<string>();
        this._changelists.forEach(list => {
            list.files.forEach(f => allTrackedFiles.add(f));
        });

        const newFiles = statusFiles.filter(f => !allTrackedFiles.has(f.path));

        // 3. Add to default changelist
        if (newFiles.length > 0) {
            const defaultList = this.getDefaultChangelist();
            defaultList.files.push(...newFiles.map(f => f.path));
        }

        this._saveState();
    }

    private _generateId(): string {
        return Date.now().toString(36) + Math.random().toString(36).substring(2);
    }
}
