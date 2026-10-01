import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import simpleGit from 'simple-git';
import { BackgroundFetchService } from './BackgroundFetchService';
import { GitService } from './GitService';
import type { RepositoryManager, RepositoryScope } from './RepositoryManager';
import { __setBackgroundFetchConfig } from '../test/mocks/vscode';

async function waitForFile(filePath: string): Promise<void> {
    const deadline = Date.now() + 3000;
    while (!fs.existsSync(filePath)) {
        if (Date.now() >= deadline) {
            throw new Error(`Timed out waiting for ${filePath}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

describe('BackgroundFetchService', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intelli-git-background-fetch-'));
        __setBackgroundFetchConfig({ enabled: false, onStartup: false, intervalMinutes: 15 });
    });

    afterEach(() => {
        __setBackgroundFetchConfig({ enabled: false, onStartup: true, intervalMinutes: 15 });
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    async function createRepository(): Promise<{ scope: RepositoryScope; worktreePath: string; helperPath: string }> {
        const remotePath = path.join(tempDir, 'remote.git');
        const seedPath = path.join(tempDir, 'seed');
        const worktreePath = path.join(tempDir, 'worktree');
        const helperPath = path.join(tempDir, 'helper');
        await simpleGit().raw(['init', '--bare', remotePath]);

        fs.mkdirSync(seedPath);
        const seed = simpleGit(seedPath);
        await seed.init();
        await seed.addConfig('user.name', 'Test User');
        await seed.addConfig('user.email', 'test@example.com');
        fs.writeFileSync(path.join(seedPath, 'README.md'), 'base\n');
        await seed.add('README.md');
        await seed.commit('Initial commit');
        const branch = (await seed.branchLocal()).current;
        await seed.addRemote('origin', remotePath);
        await seed.push(['-u', 'origin', branch]);
        await simpleGit().raw(['--git-dir', remotePath, 'symbolic-ref', 'HEAD', `refs/heads/${branch}`]);

        await simpleGit().clone(remotePath, worktreePath);
        await simpleGit().clone(remotePath, helperPath);

        return {
            scope: {
                name: 'worktree',
                repoPath: worktreePath,
                path: worktreePath,
                workspaceRoot: worktreePath,
                gitRoot: worktreePath,
                isSubmodule: false,
                kind: 'workspace',
                branch,
            },
            worktreePath,
            helperPath,
        };
    }

    function createManager(scope: RepositoryScope): RepositoryManager {
        return {
            getRepositories: () => [scope],
        } as unknown as RepositoryManager;
    }

    it('does not fetch when Intelli Git background fetch is disabled', async () => {
        const scope = {
            name: 'missing',
            repoPath: tempDir,
            path: tempDir,
            workspaceRoot: tempDir,
            gitRoot: tempDir,
            isSubmodule: false,
            kind: 'workspace',
        } satisfies RepositoryScope;
        const changed: RepositoryScope[] = [];
        const service = new BackgroundFetchService(createManager(scope), (repo) => changed.push(repo));

        await service.refreshRepositories();

        expect(changed).toEqual([]);
        service.dispose();
    });

    it('refreshes remote refs without blocking the interactive GitService queue', async () => {
        if (process.platform === 'win32') return;

        const { scope, worktreePath } = await createRepository();
        const markerPath = path.join(tempDir, 'upload-pack-started');
        const releasePath = path.join(tempDir, 'upload-pack-release');
        const uploadPackPath = path.join(tempDir, 'slow-upload-pack.sh');
        fs.writeFileSync(
            uploadPackPath,
            [
                '#!/bin/sh',
                `touch '${markerPath}'`,
                `while [ ! -f '${releasePath}' ]; do sleep 0.05; done`,
                'exec git-upload-pack "$@"',
                '',
            ].join('\n')
        );
        fs.chmodSync(uploadPackPath, 0o755);
        execFileSync('git', ['config', 'remote.origin.uploadpack', uploadPackPath], { cwd: worktreePath });

        __setBackgroundFetchConfig({ enabled: true });
        const service = new BackgroundFetchService(createManager(scope));
        const interactiveGit = await GitService.create(worktreePath);
        const fetchPromise = service.refreshRepositories();
        await waitForFile(markerPath);

        await expect(
            Promise.race([
                interactiveGit.getStatusForView(),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Interactive Git queue was blocked')), 500)
                ),
            ])
        ).resolves.toEqual([]);

        fs.writeFileSync(releasePath, 'release\n');
        await fetchPromise;
        interactiveGit.dispose();
        service.dispose();
    });

    it('keeps local reads responsive while an interactive push waits on the remote', async () => {
        if (process.platform === 'win32') return;

        const { scope, worktreePath } = await createRepository();
        const worktree = simpleGit(worktreePath);
        await worktree.addConfig('user.name', 'Test User');
        await worktree.addConfig('user.email', 'test@example.com');
        fs.writeFileSync(path.join(worktreePath, 'local.txt'), 'local\n');
        await worktree.add('local.txt');
        await worktree.commit('Local change');

        const markerPath = path.join(tempDir, 'receive-pack-started');
        const releasePath = path.join(tempDir, 'receive-pack-release');
        const receivePackPath = path.join(tempDir, 'slow-receive-pack.sh');
        fs.writeFileSync(
            receivePackPath,
            [
                '#!/bin/sh',
                `touch '${markerPath}'`,
                `while [ ! -f '${releasePath}' ]; do sleep 0.05; done`,
                'exec git-receive-pack "$@"',
                '',
            ].join('\n')
        );
        fs.chmodSync(receivePackPath, 0o755);
        execFileSync('git', ['config', 'remote.origin.receivepack', receivePackPath], { cwd: worktreePath });

        const interactiveGit = await GitService.create(worktreePath);
        const pushPromise = interactiveGit.branchRemote.push('origin', scope.branch!);
        await waitForFile(markerPath);

        await expect(
            Promise.race([
                interactiveGit.getStatusForView(),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Local Git read was blocked by push')), 500)
                ),
            ])
        ).resolves.toEqual([]);

        fs.writeFileSync(releasePath, 'release\n');
        await pushPromise;
        interactiveGit.dispose();
    });

    it('notifies only after fetched remote refs move', async () => {
        const { scope, helperPath } = await createRepository();
        const helper = simpleGit(helperPath);
        await helper.addConfig('user.name', 'Test User');
        await helper.addConfig('user.email', 'test@example.com');
        fs.writeFileSync(path.join(helperPath, 'remote.txt'), 'remote\n');
        await helper.add('remote.txt');
        await helper.commit('Remote change');
        await helper.push('origin', scope.branch!);

        __setBackgroundFetchConfig({ enabled: true });
        const changed: RepositoryScope[] = [];
        const service = new BackgroundFetchService(createManager(scope), (repo) => changed.push(repo));

        await service.refreshRepositories();

        expect(changed).toEqual([scope]);
        service.dispose();
    });
});
