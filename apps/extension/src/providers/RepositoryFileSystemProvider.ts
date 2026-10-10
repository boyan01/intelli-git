import * as path from 'node:path';
import * as vscode from 'vscode';
import type { RepositoryManager } from '../services/RepositoryManager';
import {
    getContentPathFromUri,
    parseRepositoryContentQuery,
    type RevisionContentQuery,
    type StashContentQuery,
} from '../utils/repositoryContentUri';

/** Exposes original bytes to VS Code's text, image, and binary editors. */
export class RepositoryFileSystemProvider implements vscode.FileSystemProvider, vscode.Disposable {
    private readonly changes = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile = this.changes.event;
    private readonly watched = new Map<string, { uri: vscode.Uri; count: number }>();
    private mtime = Date.now();

    constructor(
        private readonly repositoryManager: RepositoryManager,
        private readonly kind: 'revision' | 'stash'
    ) {}

    watch(uri: vscode.Uri): vscode.Disposable {
        const key = uri.toString();
        const entry = this.watched.get(key) ?? { uri, count: 0 };
        entry.count++;
        this.watched.set(key, entry);
        return {
            dispose: () => {
                if (--entry.count === 0) this.watched.delete(key);
            },
        };
    }

    refresh(): void {
        this.mtime = Date.now();
        this.changes.fire([...this.watched.values()].map(({ uri }) => ({ uri, type: vscode.FileChangeType.Changed })));
    }

    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        const content = await this.readFile(uri);
        return { type: vscode.FileType.File, ctime: 0, mtime: this.mtime, size: content.byteLength };
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        const query = parseRepositoryContentQuery<RevisionContentQuery & StashContentQuery>(uri);
        const filePath = this.kind === 'stash' ? query.path : getContentPathFromUri(uri);
        if (query.ref === undefined || !filePath) throw vscode.FileSystemError.FileNotFound(uri);
        const git = query.repoPath
            ? this.repositoryManager.getService(query.repoPath)
            : this.repositoryManager.getActiveService();
        if (!git) throw vscode.FileSystemError.FileNotFound(uri);
        if (query.ref === 'WORKTREE') {
            const workspacePath = query.pathKind === 'repo' ? git.toWorkspacePath(filePath) : filePath;
            const root = git.getWorkspaceRoot();
            if (!root || !workspacePath) throw vscode.FileSystemError.FileNotFound(uri);
            try {
                return await vscode.workspace.fs.readFile(vscode.Uri.file(path.join(root, workspacePath)));
            } catch (error) {
                if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') return new Uint8Array();
                throw error;
            }
        }
        if (query.ref === '4b825dc642cb6eb9a060e54bf8d69288fbee4904') return new Uint8Array();
        const repoPath = query.pathKind === 'workspace' ? git.toRepoPath(filePath) : filePath;
        return (await git.getFileContentBuffer(query.ref, repoPath)) ?? new Uint8Array();
    }

    readDirectory(): [string, vscode.FileType][] {
        throw vscode.FileSystemError.NoPermissions();
    }
    createDirectory(): void {
        throw vscode.FileSystemError.NoPermissions();
    }
    writeFile(): void {
        throw vscode.FileSystemError.NoPermissions();
    }
    delete(): void {
        throw vscode.FileSystemError.NoPermissions();
    }
    rename(): void {
        throw vscode.FileSystemError.NoPermissions();
    }

    dispose(): void {
        this.watched.clear();
        this.changes.dispose();
    }
}
