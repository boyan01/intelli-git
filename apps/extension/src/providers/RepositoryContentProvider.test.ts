import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { RepositoryFileSystemProvider } from './RepositoryFileSystemProvider';
import type { GitService } from '../services/GitService';
import type { RepositoryManager } from '../services/RepositoryManager';

function createGitService(content: string): GitService {
    return {
        getFileContentBuffer: async () => Buffer.from(content),
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
        const provider = new RepositoryFileSystemProvider(
            createRepositoryManager(
                {
                    '/repo/first': createGitService('first'),
                    '/repo/second': createGitService('second'),
                },
                createGitService('active')
            ),
            'revision'
        );

        const content = await provider.readFile({
            path: '/src/file.ts',
            query: JSON.stringify({ ref: 'HEAD', repoPath: '/repo/second', pathKind: 'workspace' }),
        } as never);

        expect(Buffer.from(content).toString()).toBe('second');
    });

    it('falls back to the active repository for legacy revision URIs', async () => {
        const provider = new RepositoryFileSystemProvider(
            createRepositoryManager({}, createGitService('active')),
            'revision'
        );

        const content = await provider.readFile({
            path: '/src/file.ts',
            query: JSON.stringify({ ref: 'HEAD' }),
        } as never);

        expect(Buffer.from(content).toString()).toBe('active');
    });

    it('does not fall back to the active repository when a scoped revision URI cannot be resolved', async () => {
        const provider = new RepositoryFileSystemProvider(
            createRepositoryManager({}, createGitService('active')),
            'revision'
        );

        await expect(
            provider.readFile({
                path: '/src/file.ts',
                query: JSON.stringify({ ref: 'HEAD', repoPath: '/missing/repo', pathKind: 'workspace' }),
            } as never)
        ).rejects.toThrow();
    });

    it('resolves stash content from the repo identity carried by the URI', async () => {
        const provider = new RepositoryFileSystemProvider(
            createRepositoryManager(
                {
                    '/repo/first': createGitService('first'),
                    '/repo/second': createGitService('second'),
                },
                createGitService('active')
            ),
            'stash'
        );

        const content = await provider.readFile({
            query: JSON.stringify({ ref: 'stash@{0}', path: 'src/file.ts', repoPath: '/repo/first' }),
        } as never);

        expect(Buffer.from(content).toString()).toBe('first');
    });

    it('does not fall back to the active repository when a scoped stash URI cannot be resolved', async () => {
        const provider = new RepositoryFileSystemProvider(
            createRepositoryManager({}, createGitService('active')),
            'stash'
        );

        await expect(
            provider.readFile({
                query: JSON.stringify({ ref: 'stash@{0}', path: 'src/file.ts', repoPath: '/missing/repo' }),
            } as never)
        ).rejects.toThrow();
    });
});

describe('binary repository content', () => {
    it('preserves image bytes and maps workspace paths before reading Git', async () => {
        const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0, 0x80]);
        const calls: string[][] = [];
        const git = createGitService('');
        git.getFileContentBuffer = async (ref, filePath) => {
            calls.push([ref, filePath]);
            return bytes;
        };
        const provider = new RepositoryFileSystemProvider(createRepositoryManager({}, git), 'revision');
        const uri = { path: '/image.png', query: JSON.stringify({ ref: '', pathKind: 'workspace' }) } as never;
        expect(await provider.readFile(uri)).toEqual(bytes);
        expect(await provider.stat(uri)).toMatchObject({ size: bytes.length });
        expect(calls).toEqual([
            ['', 'repo/image.png'],
            ['', 'repo/image.png'],
        ]);
    });

    it('keeps the empty history side separate from the index', async () => {
        const git = createGitService('index image');
        const provider = new RepositoryFileSystemProvider(createRepositoryManager({}, git), 'revision');
        expect(
            await provider.readFile({
                path: '/image.png',
                query: JSON.stringify({ ref: '4b825dc642cb6eb9a060e54bf8d69288fbee4904' }),
            } as never)
        ).toEqual(new Uint8Array());
    });

    it('does not disguise Git failures as empty files', async () => {
        const git = createGitService('');
        git.getFileContentBuffer = async () => {
            throw new Error('Git unavailable');
        };
        const provider = new RepositoryFileSystemProvider(createRepositoryManager({}, git), 'revision');
        await expect(
            provider.readFile({ path: '/image.png', query: JSON.stringify({ ref: 'HEAD' }) } as never)
        ).rejects.toThrow('Git unavailable');
        expect(() => provider.writeFile()).toThrow('NoPermissions');
    });
});

describe('repository content refresh', () => {
    it('notifies watched resources until the last watcher is disposed', () => {
        const provider = new RepositoryFileSystemProvider(createRepositoryManager({}), 'revision');
        const uri = vscode.Uri.parse('intelli-git-revision://load/image.png').with({
            query: JSON.stringify({ ref: '' }),
        });
        const changed = vi.fn();
        provider.onDidChangeFile(changed);
        const first = provider.watch(uri);
        const second = provider.watch(uri);
        first.dispose();
        provider.refresh();
        expect(changed).toHaveBeenLastCalledWith([{ uri, type: vscode.FileChangeType.Changed }]);
        second.dispose();
        provider.refresh();
        expect(changed).toHaveBeenLastCalledWith([]);
        provider.dispose();
    });
});
