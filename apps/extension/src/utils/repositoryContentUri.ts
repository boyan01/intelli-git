import * as vscode from 'vscode';
import type { GitService } from '../services/GitService';

export type RepositoryContentPathKind = 'workspace' | 'repo';

export interface RevisionContentQuery {
    ref: string;
    repoPath: string;
    pathKind: RepositoryContentPathKind;
    preferStaged?: boolean;
}

export interface StashContentQuery {
    ref: string;
    path: string;
    repoPath: string;
}

export function createRevisionContentUri(
    gitService: GitService,
    filePath: string,
    query: Omit<RevisionContentQuery, 'repoPath' | 'pathKind'> & { pathKind?: RepositoryContentPathKind }
): vscode.Uri {
    return vscode.Uri.parse(`intelli-git-revision://load/${encodePath(filePath)}`).with({
        query: JSON.stringify({
            ...query,
            repoPath: gitService.getWorkspaceRoot(),
            pathKind: query.pathKind || 'workspace',
        } satisfies RevisionContentQuery),
    });
}

export function createStashContentUri(gitService: GitService, ref: string, filePath: string): vscode.Uri {
    return vscode.Uri.parse(`intelli-git-stash://stash/${encodeURIComponent(ref)}/${encodePath(filePath)}`).with({
        query: JSON.stringify({
            ref,
            path: filePath,
            repoPath: gitService.getWorkspaceRoot(),
        } satisfies StashContentQuery),
    });
}

export function parseRepositoryContentQuery<T extends object>(uri: vscode.Uri): Partial<T> {
    if (!uri.query) {
        return {};
    }

    try {
        const parsed = JSON.parse(uri.query);
        return parsed && typeof parsed === 'object' ? (parsed as Partial<T>) : {};
    } catch {
        return {};
    }
}

export function getContentPathFromUri(uri: vscode.Uri): string {
    const rawPath = uri.path.startsWith('/') ? uri.path.substring(1) : uri.path;
    return decodePath(rawPath);
}

function encodePath(filePath: string): string {
    return filePath
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/');
}

function decodePath(filePath: string): string {
    return filePath
        .split('/')
        .map((segment) => {
            try {
                return decodeURIComponent(segment);
            } catch {
                return segment;
            }
        })
        .join('/');
}
