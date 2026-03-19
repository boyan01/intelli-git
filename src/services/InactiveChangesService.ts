import * as vscode from 'vscode';

export class InactiveChangesService {
    private static readonly STORAGE_KEY = 'ideaCommitPanel.inactiveChanges';
    private inactiveFiles: Set<string> = new Set();

    constructor(private context: vscode.ExtensionContext) {
        this.loadState();
    }

    private loadState() {
        const saved = this.context.workspaceState.get<string[]>(InactiveChangesService.STORAGE_KEY);
        this.inactiveFiles = new Set((saved || []).filter(Boolean));
    }

    private async saveState() {
        await this.context.workspaceState.update(
            InactiveChangesService.STORAGE_KEY,
            Array.from(this.inactiveFiles)
        );
    }

    public getInactiveFiles(): string[] {
        return Array.from(this.inactiveFiles);
    }

    public isInactive(filePath: string): boolean {
        return this.inactiveFiles.has(filePath);
    }

    public async markInactive(files: string[]): Promise<void> {
        files.forEach(file => this.inactiveFiles.add(file));
        await this.saveState();
    }

    public async markActive(files: string[]): Promise<void> {
        files.forEach(file => this.inactiveFiles.delete(file));
        await this.saveState();
    }

    public syncWithStatus(statusPaths: string[]) {
        const validPaths = new Set(statusPaths);
        let changed = false;

        Array.from(this.inactiveFiles).forEach(path => {
            if (!validPaths.has(path)) {
                this.inactiveFiles.delete(path);
                changed = true;
            }
        });

        if (changed) {
            void this.saveState();
        }
    }
}
