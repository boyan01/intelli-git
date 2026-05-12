import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import simpleGit, { type SimpleGit } from 'simple-git';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { GitLogService } from './GitLogService';

describe('GitLogService', () => {
    let tempDir: string;
    let git: SimpleGit;
    let service: GitLogService;
    let hashes: string[];

    beforeEach(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intelli-git-log-test-'));
        git = simpleGit(tempDir);
        await git.init();
        await git.addConfig('user.name', 'Test User');
        await git.addConfig('user.email', 'test@example.com');
        fs.mkdirSync(path.join(tempDir, 'app'), { recursive: true });

        fs.writeFileSync(path.join(tempDir, 'app', 'scoped.txt'), 'one\n');
        await git.add('app/scoped.txt');
        await git.commit('match root\n\nRoot body');
        const rootHash = (await git.revparse(['HEAD'])).trim();
        await git.raw(['tag', 'v1', rootHash]);
        await git.raw(['branch', 'release', rootHash]);

        fs.writeFileSync(path.join(tempDir, 'app', 'scoped.txt'), 'one\ntwo\n');
        await git.add('app/scoped.txt');
        await git.commit('hidden middle');
        const middleHash = (await git.revparse(['HEAD'])).trim();

        fs.writeFileSync(path.join(tempDir, 'app', 'scoped.txt'), 'one\ntwo\nthree\n');
        await git.add('app/scoped.txt');
        await git.commit('match head\n\nHead body');
        const headHash = (await git.revparse(['HEAD'])).trim();
        hashes = [rootHash, middleHash, headHash];

        service = new GitLogService(git, {
            toRepoPath: filePath => `app/${filePath}`,
            toWorkspacePath: repoPath => repoPath.startsWith('app/') ? repoPath.slice('app/'.length) : null,
            getWorkspaceRoot: () => path.join(tempDir, 'app')
        });
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('loads scoped log entries and stitches filtered ancestors', async () => {
        const commits = await service.getLog({
            search: 'match',
            paths: ['scoped.txt']
        });

        expect(commits.map(commit => commit.subject)).toEqual(['match head', 'match root']);
        expect(commits[0].filteredAncestors).toEqual([hashes[0]]);
        expect(commits[0].parentHashes).toEqual([hashes[1]]);
    });

    it('resolves hash searches to the exact commit', async () => {
        const commits = await service.getLog({
            search: hashes[1].slice(0, 8),
            maxCount: 20
        });

        expect(commits).toHaveLength(1);
        expect(commits[0].hash).toBe(hashes[1]);
    });

    it('returns commit details, scoped file display paths, stats, and refs', async () => {
        const details = await service.getCommitDetails(hashes[0]);

        expect(details.subject).toBe('match root');
        expect(details.body).toBe('Root body');
        expect(details.files).toEqual([
            { path: 'app/scoped.txt', displayPath: 'scoped.txt', status: 'A' }
        ]);
        expect(details.stats.additions).toBe(1);
        expect(details.refs).toEqual(expect.arrayContaining([
            { name: 'v1', type: 'tag' },
            { name: 'release', type: 'local' }
        ]));
        expect(details.containingBranches).toEqual(expect.arrayContaining(['release']));
    });

    it('returns sorted authors and the configured user', async () => {
        await expect(service.getAuthors()).resolves.toEqual(['Test User']);
        await expect(service.getCurrentUser()).resolves.toBe('Test User');
    });
});
