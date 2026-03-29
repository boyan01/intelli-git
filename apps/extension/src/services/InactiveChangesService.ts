import * as vscode from 'vscode';

interface InactiveData {
    // filePath -> set of hunkIds
    files: { [path: string]: { all?: boolean; hunkIds?: string[] } };
}

export class InactiveChangesService {
    private static readonly STORAGE_KEY_V2 = 'ideaCommitPanel.inactiveChangesV2';
    private state: InactiveData = { files: {} };

    constructor(private context: vscode.ExtensionContext) {
        this.loadState();
    }

    private loadState() {
        // Migration from V1 (if exists) or load V2
        const v1Saved = this.context.workspaceState.get<string[]>('ideaCommitPanel.inactiveChanges');
        const v2Saved = this.context.workspaceState.get<InactiveData>(InactiveChangesService.STORAGE_KEY_V2);

        if (v2Saved) {
            this.state = v2Saved;
        } else if (v1Saved && v1Saved.length > 0) {
            // Migrate V1
            v1Saved.forEach(path => {
                this.state.files[path] = { all: true };
            });
            void this.saveState();
        }
    }

    private async saveState() {
        await this.context.workspaceState.update(
            InactiveChangesService.STORAGE_KEY_V2,
            this.state
        );
    }

    public getInactiveFiles(): string[] {
        return Object.keys(this.state.files).filter(path => this.state.files[path].all);
    }

    public getInactiveHunkIds(filePath: string): string[] {
        return this.state.files[filePath]?.hunkIds || [];
    }

    public isInactive(filePath: string): boolean {
        return !!this.state.files[filePath]?.all;
    }

    public async markInactive(files: string[]): Promise<void> {
        files.forEach(file => {
            this.state.files[file] = { all: true };
        });
        await this.saveState();
    }

    public async markActive(files: string[]): Promise<void> {
        files.forEach(file => {
            delete this.state.files[file];
        });
        await this.saveState();
    }

    public async markHunkInactive(path: string, hunkId: string): Promise<void> {
        if (!this.state.files[path]) {
            this.state.files[path] = { hunkIds: [] };
        }
        const fileInfo = this.state.files[path];
        if (!fileInfo.all) {
            const hunkIds = new Set(fileInfo.hunkIds || []);
            hunkIds.add(hunkId);
            fileInfo.hunkIds = Array.from(hunkIds);
        }
        await this.saveState();
    }

    public async markHunkActive(path: string, hunkId: string): Promise<void> {
        const fileInfo = this.state.files[path];
        if (fileInfo && fileInfo.hunkIds) {
            fileInfo.hunkIds = fileInfo.hunkIds.filter(id => id !== hunkId);
            if (fileInfo.hunkIds.length === 0 && !fileInfo.all) {
                delete this.state.files[path];
            }
        }
        await this.saveState();
    }

    public syncWithStatus(statusPaths: string[]) {
        const validPaths = new Set(statusPaths);
        let changed = false;

        Object.keys(this.state.files).forEach(path => {
            if (!validPaths.has(path)) {
                delete this.state.files[path];
                changed = true;
            }
        });

        if (changed) {
            void this.saveState();
        }
    }
}
