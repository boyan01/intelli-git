import { describe, expect, it } from 'vitest';
import { RevisionContentProvider } from './RevisionContentProvider';
import { StashContentProvider } from './StashContentProvider';
import type { GitService } from '../services/GitService';
import type { RepositoryManager } from '../services/RepositoryManager';

function createGitService(content: string): GitService {
    return {
        getFileContent: async () => content,
        toRepoPath: (filePath: string) => `repo/${filePath}`,
        toWorkspacePath: (repoPath: string) => repoPath.replace(/^repo\//, ''),
        getWorkspaceRoot: () => '/workspace',
    } as unknown as GitService;
}

function createRepositoryManager(services: Record<string, GitService>, active?: GitService): RepositoryManager {
    return {
        getService: (repoPath: string | undefined) => (repoPath ? services[repoPath] : undefined),
        getActiveService: () => active,
    } as unknown as RepositoryManager;
}

describe('repository content providers', () => {
    it('resolves revision content from the repo identity carried by the URI', async () => {
        const provider = new RevisionContentProvider(
            createRepositoryManager(
                {
                    '/repo/first': createGitService('first'),
                    '/repo/second': createGitService('second'),
                },
                createGitService('active')
            )
        );

        const content = await provider.provideTextDocumentContent({
            path: '/src/file.ts',
            query: JSON.stringify({ ref: 'HEAD', repoPath: '/repo/second', pathKind: 'workspace' }),
        } as never);

        expect(content).toBe('second');
    });

    it('falls back to the active repository for legacy revision URIs', async () => {
        const provider = new RevisionContentProvider(createRepositoryManager({}, createGitService('active')));

        const content = await provider.provideTextDocumentContent({
            path: '/src/file.ts',
            query: JSON.stringify({ ref: 'HEAD' }),
        } as never);

        expect(content).toBe('active');
    });

    it('does not fall back to the active repository when a scoped revision URI cannot be resolved', async () => {
        const provider = new RevisionContentProvider(createRepositoryManager({}, createGitService('active')));

        const content = await provider.provideTextDocumentContent({
            path: '/src/file.ts',
            query: JSON.stringify({ ref: 'HEAD', repoPath: '/missing/repo', pathKind: 'workspace' }),
        } as never);

        expect(content).toBe('');
    });

    it('resolves stash content from the repo identity carried by the URI', async () => {
        const provider = new StashContentProvider(
            createRepositoryManager(
                {
                    '/repo/first': createGitService('first'),
                    '/repo/second': createGitService('second'),
                },
                createGitService('active')
            )
        );

        const content = await provider.provideTextDocumentContent({
            query: JSON.stringify({ ref: 'stash@{0}', path: 'src/file.ts', repoPath: '/repo/first' }),
        } as never);

        expect(content).toBe('first');
    });

    it('does not fall back to the active repository when a scoped stash URI cannot be resolved', async () => {
        const provider = new StashContentProvider(createRepositoryManager({}, createGitService('active')));

        const content = await provider.provideTextDocumentContent({
            query: JSON.stringify({ ref: 'stash@{0}', path: 'src/file.ts', repoPath: '/missing/repo' }),
        } as never);

        expect(content).toBe('');
    });
});
