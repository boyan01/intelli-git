import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import type { GitService } from '../GitService';
import type { RepositoryManager } from '../RepositoryManager';
import {
    getContentPathFromUri,
    parseRepositoryContentQuery,
    type RepositoryContentPathKind,
    type RevisionContentQuery,
} from '../../utils/repositoryContentUri';
import type { FileBlame } from './blameParser';

const REVISION_SCHEME = 'intelli-git-revision';

export interface DocumentBlame {
    service: GitService;
    /** Repository key accepted by RepositoryManager.getService(). */
    repoPath: string;
    /** Workspace-relative path used by GitService APIs. */
    filePath: string;
    blame: FileBlame;
}

interface BlameCacheEntry {
    version: number;
    generation: number;
    promise: Promise<DocumentBlame | undefined>;
}

/**
 * Computes and caches `git blame` for open documents. Entries are keyed by document URI and
 * reused while the document version and the repository state stay unchanged.
 */
export class BlameService implements vscode.Disposable {
    private readonly cache = new Map<string, BlameCacheEntry>();
    private readonly messageCache = new Map<string, string>();
    private readonly serviceSubscriptions = new Map<GitService, vscode.Disposable>();
    private readonly disposables: vscode.Disposable[] = [];
    private readonly _onDidInvalidate = new vscode.EventEmitter<void>();
    private generation = 0;

    public readonly onDidInvalidate = this._onDidInvalidate.event;

    constructor(private readonly repositoryManager: RepositoryManager) {
        this.disposables.push(
            this._onDidInvalidate,
            repositoryManager.onDidChangeRepositories(() => {
                this.disposeServiceSubscriptions();
                this.invalidateAll();
            }),
            vscode.workspace.onDidCloseTextDocument((document) => {
                this.cache.delete(document.uri.toString());
            }),
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration('intelli-git.blame.ignoreWhitespace')) {
                    this.invalidateAll();
                }
            })
        );
    }

    public static isBlameable(document: vscode.TextDocument): boolean {
        if (document.uri.scheme === REVISION_SCHEME) {
            return getRevisionDocumentQuery(document.uri) !== undefined;
        }
        return document.uri.scheme === 'file' && !document.isUntitled;
    }

    public getBlame(document: vscode.TextDocument): Promise<DocumentBlame | undefined> {
        if (!BlameService.isBlameable(document)) {
            return Promise.resolve(undefined);
        }

        const key = document.uri.toString();
        const cached = this.cache.get(key);
        if (cached && cached.version === document.version && cached.generation === this.generation) {
            return cached.promise;
        }

        const promise = this.computeBlame(document);
        this.cache.set(key, { version: document.version, generation: this.generation, promise });
        return promise;
    }

    /**
     * Returns full commit messages, reading the missing ones with one batched git call.
     */
    public async getCommitMessages(service: GitService, hashes: string[]): Promise<Map<string, string>> {
        const result = new Map<string, string>();
        const missing: string[] = [];
        for (const hash of hashes) {
            const message = this.messageCache.get(hash);
            if (message !== undefined) {
                result.set(hash, message);
            } else {
                missing.push(hash);
            }
        }

        if (missing.length > 0) {
            const loaded = await service.getCommitMessages(missing);
            for (const [hash, message] of loaded) {
                this.messageCache.set(hash, message);
                result.set(hash, message);
            }
        }
        return result;
    }

    public invalidateAll(): void {
        this.generation++;
        this.cache.clear();
        this._onDidInvalidate.fire();
    }

    public dispose(): void {
        this.disposeServiceSubscriptions();
        this.cache.clear();
        this.messageCache.clear();
        this.disposables.forEach((disposable) => disposable.dispose());
        this.disposables.length = 0;
    }

    private async computeBlame(document: vscode.TextDocument): Promise<DocumentBlame | undefined> {
        if (document.uri.scheme === REVISION_SCHEME) {
            return this.computeRevisionBlame(document.uri);
        }

        const repository = this.repositoryManager.getRepositoryForFile(document.uri.fsPath);
        if (!repository) {
            return undefined;
        }

        const { service, scope } = repository;
        this.watchService(service);

        const filePath = toWorkspaceRelativePath(service.getWorkspaceRoot(), document.uri.fsPath);
        const ignoreWhitespace = vscode.workspace
            .getConfiguration('intelli-git.blame')
            .get<boolean>('ignoreWhitespace', false);
        const blame = await service.getFileBlame(filePath, {
            contents: document.isDirty ? document.getText() : undefined,
            ignoreWhitespace,
        });
        return blame ? { service, repoPath: scope.repoPath, filePath, blame } : undefined;
    }

    /**
     * Blames a read-only revision document (for example one opened by "Annotate Revision"),
     * so its lines are attributed as of that commit.
     */
    private async computeRevisionBlame(uri: vscode.Uri): Promise<DocumentBlame | undefined> {
        const query = getRevisionDocumentQuery(uri);
        const service = query ? this.repositoryManager.getService(query.repoPath) : undefined;
        if (!query || !service) {
            return undefined;
        }

        const ignoreWhitespace = vscode.workspace
            .getConfiguration('intelli-git.blame')
            .get<boolean>('ignoreWhitespace', false);
        const blame = await service.getFileBlame(query.filePath, {
            revision: query.ref,
            pathKind: query.pathKind,
            ignoreWhitespace,
        });
        if (!blame) {
            return undefined;
        }
        const filePath =
            query.pathKind === 'repo' ? (service.toWorkspacePath(query.filePath) ?? query.filePath) : query.filePath;
        return { service, repoPath: query.repoPath, filePath, blame };
    }

    private watchService(service: GitService): void {
        if (this.serviceSubscriptions.has(service)) {
            return;
        }
        this.serviceSubscriptions.set(
            service,
            service.onDidChange((kind) => {
                if (kind === 'local') {
                    this.invalidateAll();
                }
            })
        );
    }

    private disposeServiceSubscriptions(): void {
        this.serviceSubscriptions.forEach((subscription) => subscription.dispose());
        this.serviceSubscriptions.clear();
    }
}

interface RevisionDocumentQuery {
    ref: string;
    repoPath: string;
    pathKind: RepositoryContentPathKind;
    filePath: string;
}

function getRevisionDocumentQuery(uri: vscode.Uri): RevisionDocumentQuery | undefined {
    const query = parseRepositoryContentQuery<RevisionContentQuery>(uri);
    const filePath = getContentPathFromUri(uri);
    if (!query.ref || !/^[0-9a-f]{7,64}$/i.test(query.ref) || !query.repoPath || !filePath) {
        return undefined;
    }
    return { ref: query.ref, repoPath: query.repoPath, pathKind: query.pathKind ?? 'workspace', filePath };
}

function toWorkspaceRelativePath(workspaceRoot: string, fsPath: string): string {
    let resolved = fsPath;
    try {
        resolved = fs.realpathSync.native(fsPath);
    } catch {
        // Unsaved or deleted files keep their editor path.
    }
    return path.relative(workspaceRoot, resolved).split(path.sep).join('/');
}
