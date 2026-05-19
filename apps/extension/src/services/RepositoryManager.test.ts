import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import simpleGit, { type SimpleGit } from 'simple-git';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { RepositoryManager } from './RepositoryManager';
import { __setWorkspaceFolders } from '../test/mocks/vscode';

interface WorkspaceState {
    get<T>(key: string, defaultValue?: T): T | undefined;
    update(key: string, value: unknown): Promise<void>;
}

function createWorkspaceState(): WorkspaceState {
    const values = new Map<string, unknown>();
    return {
        get<T>(key: string, defaultValue?: T): T | undefined {
            return values.has(key) ? values.get(key) as T : defaultValue;
        },
        async update(key: string, value: unknown): Promise<void> {
            if (value === undefined) {
                values.delete(key);
                return;
            }
            values.set(key, value);
        }
    };
}

function createExtensionContext() {
    return {
        workspaceState: createWorkspaceState(),
        subscriptions: []
    };
}

async function createCommittedRepository(repoPath: string): Promise<SimpleGit> {
    fs.mkdirSync(repoPath, { recursive: true });
    const git = simpleGit(repoPath);
    await git.init();
    await git.addConfig('user.name', 'Test User');
    await git.addConfig('user.email', 'test@example.com');
    fs.writeFileSync(path.join(repoPath, 'README.md'), 'base\n');
    await git.add('README.md');
    await git.commit('Initial commit');
    return git;
}

describe('RepositoryManager worktree discovery', () => {
    let tempDir: string;
    let manager: RepositoryManager | undefined;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intelli-git-repos-test-'));
    });

    afterEach(() => {
        manager?.dispose();
        __setWorkspaceFolders(undefined);
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('adds linked worktrees to the repository switch list', async () => {
        const repoPath = path.join(tempDir, 'repo');
        const worktreePath = path.join(tempDir, 'repo-worktree');
        const git = await createCommittedRepository(repoPath);
        const mainBranch = (await git.branchLocal()).current;
        await git.raw(['worktree', 'add', '-b', 'codex/worktree-test', worktreePath]);

        __setWorkspaceFolders([repoPath]);
        manager = new RepositoryManager(createExtensionContext() as never);
        await manager.initialize();

        const repos = manager.getRepositories();
        const workspaceRepo = repos.find(repo => repo.repoPath === fs.realpathSync(repoPath));
        const worktreeRepo = repos.find(repo => repo.repoPath === fs.realpathSync(worktreePath));

        expect(workspaceRepo).toMatchObject({
            kind: 'workspace',
            branch: mainBranch,
            isSubmodule: false
        });
        expect(worktreeRepo).toMatchObject({
            kind: 'worktree',
            branch: 'codex/worktree-test',
            mainWorktreePath: fs.realpathSync(repoPath),
            isSubmodule: false,
            isDetached: false
        });
        expect(worktreeRepo?.head).toMatch(/^[0-9a-f]{40}$/);
        expect(worktreeRepo?.gitDir).toContain(path.join('.git', 'worktrees'));
    });

    it('marks the opened folder as a worktree when VS Code opens a linked worktree', async () => {
        const repoPath = path.join(tempDir, 'repo');
        const worktreePath = path.join(tempDir, 'repo-worktree');
        const git = await createCommittedRepository(repoPath);
        const mainBranch = (await git.branchLocal()).current;
        await git.raw(['worktree', 'add', '-b', 'codex/worktree-window', worktreePath]);

        __setWorkspaceFolders([worktreePath]);
        manager = new RepositoryManager(createExtensionContext() as never);
        await manager.initialize();

        const mainRepoPath = fs.realpathSync(repoPath);
        const openedWorktreePath = fs.realpathSync(worktreePath);
        const repos = manager.getRepositories();
        const mainRepo = repos.find(repo => repo.repoPath === mainRepoPath);
        const openedWorktreeRepo = repos.find(repo => repo.repoPath === openedWorktreePath);

        expect(manager.getActiveScope()).toMatchObject({
            repoPath: openedWorktreePath,
            kind: 'worktree',
            branch: 'codex/worktree-window',
            mainWorktreePath: mainRepoPath
        });
        expect(openedWorktreeRepo).toMatchObject({
            kind: 'worktree',
            branch: 'codex/worktree-window',
            mainWorktreePath: mainRepoPath,
            isSubmodule: false,
            isDetached: false
        });
        expect(mainRepo).toMatchObject({
            kind: 'workspace',
            branch: mainBranch,
            isSubmodule: false
        });
    });

    it('skips prunable worktrees left behind by removed directories', async () => {
        const repoPath = path.join(tempDir, 'repo');
        const staleWorktreePath = path.join(tempDir, 'stale-worktree');
        const git = await createCommittedRepository(repoPath);
        await git.raw(['worktree', 'add', '-b', 'codex/stale-worktree', staleWorktreePath]);
        fs.rmSync(staleWorktreePath, { recursive: true, force: true });

        __setWorkspaceFolders([repoPath]);
        manager = new RepositoryManager(createExtensionContext() as never);
        await manager.initialize();

        expect(manager.getRepositories().map(repo => repo.repoPath)).not.toContain(path.normalize(staleWorktreePath));
    });
});
