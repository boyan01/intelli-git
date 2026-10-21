import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import simpleGit, { type SimpleGit } from 'simple-git';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FileStatus } from '@shared/messages';
import { GitService } from './GitService';
import { GitBranchRemoteService } from './GitBranchRemoteService';
import { ReviewedStateService } from './ReviewedStateService';

interface GitServiceInternals {
    createEditorGit(envOverrides: NodeJS.ProcessEnv): SimpleGit;
}

describe('GitService without build expiration', () => {
    let tempDir: string;

    afterEach(() => {
        vi.unstubAllGlobals();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('stages and commits files even when a legacy expiration flag is set', async () => {
        vi.stubGlobal('__IS_EXPIRED__', true);
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intelli-git-no-expiration-test-'));
        const git = simpleGit(tempDir);
        await git.init();
        await git.addConfig('user.name', 'Intelli Git Test');
        await git.addConfig('user.email', 'intelli-git-test@example.com');
        await git.addConfig('commit.gpgsign', 'false');
        fs.writeFileSync(path.join(tempDir, 'single.txt'), 'Single file change\n');
        fs.writeFileSync(path.join(tempDir, 'batch.txt'), 'Batch file change\n');
        const service = new GitService(tempDir, tempDir, git);

        await service.stageFile('single.txt');
        await service.stageFiles(['batch.txt']);
        await service.commit('Commit without build expiration');

        expect((await git.status()).isClean()).toBe(true);
        expect(await git.raw(['ls-tree', '--name-only', 'HEAD'])).toBe('batch.txt\nsingle.txt\n');
    });
});

describe('GitService git environment handling', () => {
    let tempDir: string;
    let originalPager: string | undefined;
    let originalGitPager: string | undefined;

    beforeEach(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intelli-git-env-test-'));
        await simpleGit(tempDir).init();
        originalPager = process.env.PAGER;
        originalGitPager = process.env.GIT_PAGER;
    });

    afterEach(() => {
        if (originalPager === undefined) {
            delete process.env.PAGER;
        } else {
            process.env.PAGER = originalPager;
        }

        if (originalGitPager === undefined) {
            delete process.env.GIT_PAGER;
        } else {
            process.env.GIT_PAGER = originalGitPager;
        }

        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('filters unsafe pager env without mutating the shared git instance', async () => {
        process.env.PAGER = 'less -R';
        process.env.GIT_PAGER = 'delta';

        const sharedGit = simpleGit(tempDir);
        const service = new GitService(tempDir, tempDir, sharedGit);
        const editorGit = (service as unknown as GitServiceInternals).createEditorGit({
            GIT_EDITOR: 'true',
        });

        await expect(editorGit.status()).resolves.toBeTruthy();
        await expect(sharedGit.status()).resolves.toBeTruthy();
    });
});

describe('GitService mutation queue', () => {
    let tempDir: string;
    let git: SimpleGit;

    beforeEach(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intelli-git-mutation-queue-test-'));
        git = simpleGit(tempDir);
        await git.init();
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('serializes concurrent mutations while allowing nested mutation calls', async () => {
        const service = new GitService(tempDir, tempDir, git);
        const events: string[] = [];
        let releaseFirst: (() => void) | undefined;
        const firstCanFinish = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });

        const first = service.runGitMutation(async () => {
            events.push('first:start');
            await service.runGitMutation(async () => {
                events.push('first:nested');
            });
            await firstCanFinish;
            events.push('first:end');
        });
        const second = service.runGitMutation(async () => {
            events.push('second:start');
        });

        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(events).toEqual(['first:start', 'first:nested']);

        releaseFirst?.();
        await Promise.all([first, second]);

        expect(events).toEqual(['first:start', 'first:nested', 'first:end', 'second:start']);
    });
});

describe('GitService commit view status cache', () => {
    it('joins concurrent view loads and reuses the result until invalidated', async () => {
        let releaseStatus: ((value: { files: never[]; conflicted: never[]; current: string }) => void) | undefined;
        const firstStatus = new Promise<{ files: never[]; conflicted: never[]; current: string }>((resolve) => {
            releaseStatus = resolve;
        });
        const status = vi
            .fn()
            .mockReturnValueOnce(firstStatus)
            .mockResolvedValue({ files: [], conflicted: [], current: 'main' });
        const service = new GitService('/workspace', '/workspace', { status } as unknown as SimpleGit);

        const first = service.getStatusForView();
        const second = service.getStatusForView();
        expect(status).toHaveBeenCalledOnce();

        releaseStatus?.({ files: [], conflicted: [], current: 'main' });
        await expect(Promise.all([first, second])).resolves.toEqual([[], []]);

        await expect(service.getStatusForView()).resolves.toEqual([]);
        expect(status).toHaveBeenCalledOnce();

        service.invalidateStatusCache();
        await expect(service.getStatusForView()).resolves.toEqual([]);
        expect(status).toHaveBeenCalledTimes(2);

        await expect(service.refreshStatusCache()).resolves.toEqual({
            commitChanged: false,
            branchChanged: false,
        });
        status.mockResolvedValueOnce({ files: [], conflicted: [], current: 'feature' });
        await expect(service.refreshStatusCache()).resolves.toEqual({
            commitChanged: false,
            branchChanged: true,
        });
    });
});

describe('GitService repository scope', () => {
    let tempDir: string;
    let git: SimpleGit;

    beforeEach(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intelli-git-scope-test-'));
        git = simpleGit(tempDir);
        await git.init();
        await git.addConfig('user.name', 'Test User');
        await git.addConfig('user.email', 'test@example.com');
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('preserves workspace scope when the opened folder is inside the git root', async () => {
        fs.mkdirSync(path.join(tempDir, 'app', 'src'), { recursive: true });
        fs.writeFileSync(path.join(tempDir, 'root.txt'), 'base\n');
        fs.writeFileSync(path.join(tempDir, 'app', 'src', 'scoped.txt'), 'base\n');
        await git.add(['root.txt', 'app/src/scoped.txt']);
        await git.commit('Initial commit');

        fs.writeFileSync(path.join(tempDir, 'root.txt'), 'changed\n');
        fs.writeFileSync(path.join(tempDir, 'app', 'src', 'scoped.txt'), 'changed\n');

        const workspaceRoot = path.join(tempDir, 'app');
        const service = await GitService.create(workspaceRoot);
        const status = await service.getStatus();

        expect(service.getWorkspaceRoot()).toBe(fs.realpathSync(workspaceRoot));
        expect(service.getGitRoot()).toBe(fs.realpathSync(tempDir));
        expect(status.map((file) => file.path)).toEqual(['src/scoped.txt']);
    });
});

describe('GitService blame lookup', () => {
    let tempDir: string;
    let git: SimpleGit;

    beforeEach(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intelli-git-blame-test-'));
        git = simpleGit(tempDir);
        await git.init();
        await git.addConfig('user.name', 'Test User');
        await git.addConfig('user.email', 'test@example.com');
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('returns the committed hash for a blamed line', async () => {
        fs.writeFileSync(path.join(tempDir, 'tracked.txt'), 'first\nsecond\n');
        await git.add('tracked.txt');
        await git.commit('Initial commit');

        const service = new GitService(tempDir, tempDir, git);
        const expectedHash = (await git.revparse(['HEAD'])).trim();

        await expect(service.getBlameCommitForLine('tracked.txt', 1)).resolves.toBe(expectedHash);
    });

    it('returns null for an uncommitted line', async () => {
        fs.writeFileSync(path.join(tempDir, 'tracked.txt'), 'first\n');
        await git.add('tracked.txt');
        await git.commit('Initial commit');
        fs.writeFileSync(path.join(tempDir, 'tracked.txt'), 'first\nsecond\n');

        const service = new GitService(tempDir, tempDir, git);

        await expect(service.getBlameCommitForLine('tracked.txt', 2)).resolves.toBeNull();
    });
});

describe('GitService conflict resolution', () => {
    let tempDir: string;
    let git: SimpleGit;

    beforeEach(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intelli-git-conflict-test-'));
        git = simpleGit(tempDir);
        await git.init();
        await git.addConfig('user.name', 'Test User');
        await git.addConfig('user.email', 'test@example.com');
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    async function createTextConflicts(filePaths: string[] = ['conflict.txt']): Promise<GitService> {
        filePaths.forEach((filePath) => {
            fs.mkdirSync(path.dirname(path.join(tempDir, filePath)), { recursive: true });
            fs.writeFileSync(path.join(tempDir, filePath), `base:${filePath}\n`);
        });
        await git.add('.');
        await git.commit('Initial commit');

        const baseBranch = (await git.branch()).current;
        await git.checkoutLocalBranch('feature');
        filePaths.forEach((filePath) => {
            fs.writeFileSync(path.join(tempDir, filePath), `incoming:${filePath}\n`);
        });
        await git.add('.');
        await git.commit('Incoming change');

        await git.checkout(baseBranch);
        filePaths.forEach((filePath) => {
            fs.writeFileSync(path.join(tempDir, filePath), `current:${filePath}\n`);
        });
        await git.add('.');
        await git.commit('Current change');

        try {
            await git.merge(['feature']);
        } catch {
            // The conflict state is the scenario under test.
        }

        return new GitService(tempDir, tempDir, git);
    }

    it('rejects whole-side resolution after the conflict was staged externally', async () => {
        const service = await createTextConflicts();
        const resultPath = path.join(tempDir, 'conflict.txt');
        fs.writeFileSync(resultPath, 'external resolution\n');
        await git.add('conflict.txt');
        const indexBefore = await git.raw(['ls-files', '-s', '--', 'conflict.txt']);

        await expect(service.resolveConflict('conflict.txt', 'ours')).rejects.toThrow('No unresolved conflict found');

        expect(fs.readFileSync(resultPath, 'utf8')).toBe('external resolution\n');
        expect(await git.raw(['ls-files', '-s', '--', 'conflict.txt'])).toBe(indexBefore);
        expect((await git.status()).staged).toContain('conflict.txt');
    });

    it('resolves a conflict filename as a literal pathspec', async () => {
        const service = await createTextConflicts(['*.txt', 'other.txt']);
        const literalPath = path.join(tempDir, '*.txt');
        fs.writeFileSync(literalPath, 'manual literal resolution\n');

        const status = await service.getStatus();
        expect(status.find((file) => file.path === '*.txt')?.resolvedCandidate).toBe(true);
        expect(status.find((file) => file.path === 'other.txt')?.resolvedCandidate).toBe(false);

        await service.resolveConflict('*.txt', 'ours');

        expect(fs.readFileSync(literalPath, 'utf8')).toBe('current:*.txt\n');
        const unmerged = await git.raw(['ls-files', '-u', '-z']);
        expect(unmerged).not.toContain('\t*.txt\0');
        expect(unmerged).toContain('\tother.txt\0');
    });

    it('resolves modify/delete conflicts by staging the deleted side instead of writing an empty file', async () => {
        fs.writeFileSync(path.join(tempDir, 'delete-on-incoming.txt'), 'base\n');
        await git.add('delete-on-incoming.txt');
        await git.commit('Initial commit');

        const baseBranch = (await git.branch()).current;
        await git.checkoutLocalBranch('feature');
        fs.unlinkSync(path.join(tempDir, 'delete-on-incoming.txt'));
        await git.rm('delete-on-incoming.txt');
        await git.commit('Incoming delete');

        await git.checkout(baseBranch);
        fs.writeFileSync(path.join(tempDir, 'delete-on-incoming.txt'), 'current edit\n');
        await git.add('delete-on-incoming.txt');
        await git.commit('Current edit');

        try {
            await git.merge(['feature']);
        } catch {
            // The modify/delete conflict state is the scenario under test.
        }

        const service = new GitService(tempDir, tempDir, git);
        await service.resolveConflict('delete-on-incoming.txt', 'theirs');

        expect(fs.existsSync(path.join(tempDir, 'delete-on-incoming.txt'))).toBe(false);
        expect((await git.raw(['ls-files', '-u', '--', 'delete-on-incoming.txt'])).trim()).toBe('');
        expect(await git.raw(['diff', '--cached', '--name-status', '--', 'delete-on-incoming.txt'])).toContain(
            'D\tdelete-on-incoming.txt'
        );
    });

    it('treats invalid UTF-8 without NUL bytes as binary while preserving whole-side resolution', async () => {
        const baseContent = Buffer.concat([Buffer.from([0xff]), Buffer.from('base\n')]);
        const currentContent = Buffer.concat([Buffer.from([0xff]), Buffer.from('current\n')]);
        const incomingContent = Buffer.concat([Buffer.from([0xff]), Buffer.from('incoming\n')]);
        fs.writeFileSync(path.join(tempDir, 'invalid-utf8.dat'), baseContent);
        await git.add('invalid-utf8.dat');
        await git.commit('Initial invalid UTF-8 content');

        const baseBranch = (await git.branch()).current;
        await git.checkoutLocalBranch('feature');
        fs.writeFileSync(path.join(tempDir, 'invalid-utf8.dat'), incomingContent);
        await git.add('invalid-utf8.dat');
        await git.commit('Incoming invalid UTF-8 change');

        await git.checkout(baseBranch);
        fs.writeFileSync(path.join(tempDir, 'invalid-utf8.dat'), currentContent);
        await git.add('invalid-utf8.dat');
        await git.commit('Current invalid UTF-8 change');

        try {
            await git.merge(['feature']);
        } catch {
            // The invalid UTF-8 conflict state is the scenario under test.
        }

        const service = new GitService(tempDir, tempDir, git);
        const incomingObjectId = (await git.raw(['ls-files', '-u', '--', 'invalid-utf8.dat']))
            .split('\n')
            .find((line) => /\s3\t/.test(line))
            ?.split(/\s+/)[1];

        const conflict = (await service.getStatus()).find((file) => file.path === 'invalid-utf8.dat');
        expect(conflict?.resolvedCandidate).toBe(false);

        await service.resolveConflict('invalid-utf8.dat', 'theirs');

        expect(fs.readFileSync(path.join(tempDir, 'invalid-utf8.dat'))).toEqual(incomingContent);
        expect((await git.revparse([':invalid-utf8.dat'])).trim()).toBe(incomingObjectId);
    });

    it('blocks whole-side resolution for gitlink conflicts without changing the selected submodule commit', async () => {
        const submoduleRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'intelli-git-submodule-test-'));
        try {
            const submoduleGit = simpleGit(submoduleRepo);
            await submoduleGit.init();
            await submoduleGit.addConfig('user.name', 'Test User');
            await submoduleGit.addConfig('user.email', 'test@example.com');
            fs.writeFileSync(path.join(submoduleRepo, 'content.txt'), 'base\n');
            await submoduleGit.add('content.txt');
            await submoduleGit.commit('Base submodule commit');
            const baseObjectId = (await submoduleGit.revparse(['HEAD'])).trim();

            await submoduleGit.checkoutLocalBranch('current');
            fs.writeFileSync(path.join(submoduleRepo, 'content.txt'), 'current\n');
            await submoduleGit.add('content.txt');
            await submoduleGit.commit('Current submodule commit');
            const currentObjectId = (await submoduleGit.revparse(['HEAD'])).trim();

            await submoduleGit.checkout(baseObjectId);
            await submoduleGit.checkoutLocalBranch('incoming');
            fs.writeFileSync(path.join(submoduleRepo, 'content.txt'), 'incoming\n');
            await submoduleGit.add('content.txt');
            await submoduleGit.commit('Incoming submodule commit');
            const incomingObjectId = (await submoduleGit.revparse(['HEAD'])).trim();

            git.env('GIT_ALLOW_PROTOCOL', 'file');
            await git.raw(['submodule', 'add', submoduleRepo, 'module']);
            const moduleGit = simpleGit(path.join(tempDir, 'module'));
            await moduleGit.checkout(baseObjectId);
            await git.add(['.gitmodules', 'module']);
            await git.commit('Add base submodule');

            const baseBranch = (await git.branch()).current;
            await git.checkoutLocalBranch('feature');
            await moduleGit.checkout(incomingObjectId);
            await git.add('module');
            await git.commit('Select incoming submodule commit');

            await git.checkout(baseBranch);
            await moduleGit.checkout(currentObjectId);
            await git.add('module');
            await git.commit('Select current submodule commit');

            try {
                await git.merge(['feature']);
            } catch {
                // The gitlink conflict state is the scenario under test.
            }

            const service = new GitService(tempDir, tempDir, git);
            const indexBefore = await git.raw(['ls-files', '-u', '--', 'module']);
            const worktreeHeadBefore = (await moduleGit.revparse(['HEAD'])).trim();

            await expect(service.resolveConflict('module', 'theirs')).rejects.toThrow('cannot be edited');

            expect(await git.raw(['ls-files', '-u', '--', 'module'])).toBe(indexBefore);
            expect((await moduleGit.revparse(['HEAD'])).trim()).toBe(worktreeHeadBefore);
        } finally {
            fs.rmSync(submoduleRepo, { recursive: true, force: true });
        }
    });

    it('marks only existing text conflict files without markers as resolved candidates', async () => {
        fs.writeFileSync(path.join(tempDir, 'conflict.txt'), 'base\n');
        await git.add('conflict.txt');
        await git.commit('Initial commit');

        const baseBranch = (await git.branch()).current;
        await git.checkoutLocalBranch('feature');
        fs.writeFileSync(path.join(tempDir, 'conflict.txt'), 'incoming\n');
        await git.add('conflict.txt');
        await git.commit('Incoming change');

        await git.checkout(baseBranch);
        fs.writeFileSync(path.join(tempDir, 'conflict.txt'), 'current\n');
        await git.add('conflict.txt');
        await git.commit('Current change');

        try {
            await git.merge(['feature']);
        } catch {
            // The conflict state is the scenario under test.
        }

        const service = new GitService(tempDir, tempDir, git);

        let conflict = (await service.getStatus()).find((file) => file.path === 'conflict.txt');
        expect(conflict?.resolvedCandidate).toBe(false);

        fs.writeFileSync(path.join(tempDir, 'conflict.txt'), 'manual resolution\n');
        conflict = (await service.getStatus()).find((file) => file.path === 'conflict.txt');
        expect(conflict?.resolvedCandidate).toBe(true);

        fs.writeFileSync(path.join(tempDir, 'conflict.txt'), Buffer.from([0, 1, 2]));
        conflict = (await service.getStatus()).find((file) => file.path === 'conflict.txt');
        expect(conflict?.resolvedCandidate).toBe(false);

        fs.unlinkSync(path.join(tempDir, 'conflict.txt'));
        conflict = (await service.getStatus()).find((file) => file.path === 'conflict.txt');
        expect(conflict?.resolvedCandidate).toBe(false);
    });

    it('does not mark unresolved modify/delete conflicts as resolved candidates', async () => {
        fs.writeFileSync(path.join(tempDir, 'delete-on-incoming.txt'), 'base\n');
        await git.add('delete-on-incoming.txt');
        await git.commit('Initial commit');

        const baseBranch = (await git.branch()).current;
        await git.checkoutLocalBranch('feature');
        fs.unlinkSync(path.join(tempDir, 'delete-on-incoming.txt'));
        await git.rm('delete-on-incoming.txt');
        await git.commit('Incoming delete');

        await git.checkout(baseBranch);
        fs.writeFileSync(path.join(tempDir, 'delete-on-incoming.txt'), 'current edit without markers\n');
        await git.add('delete-on-incoming.txt');
        await git.commit('Current edit');

        try {
            await git.merge(['feature']);
        } catch {
            // The modify/delete conflict state is the scenario under test.
        }

        const service = new GitService(tempDir, tempDir, git);
        const conflict = (await service.getStatus()).find((file) => file.path === 'delete-on-incoming.txt');

        expect(conflict?.status).toBe('C');
        expect(conflict?.resolvedCandidate).toBe(false);
    });
});

describe('GitService change blocks and changelist plans', () => {
    let tempDir: string;
    let git: SimpleGit;

    beforeEach(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intelli-git-stage-test-'));
        git = simpleGit(tempDir);
        await git.init();
        await git.addConfig('user.name', 'Test User');
        await git.addConfig('user.email', 'test@example.com');
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('gives each change one HEAD-relative identity whether it is staged or not', async () => {
        fs.writeFileSync(
            path.join(tempDir, 'partial.txt'),
            [
                'one',
                'two',
                'three',
                'four',
                'five',
                'six',
                'seven',
                'eight',
                'nine',
                'ten',
                'eleven',
                'twelve',
                '',
            ].join('\n')
        );
        await git.add('partial.txt');
        await git.commit('Initial commit');

        fs.writeFileSync(
            path.join(tempDir, 'partial.txt'),
            ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', '']
                .map((line) => (line === 'one' ? 'one staged' : line === 'ten' ? 'ten unstaged' : line))
                .join('\n')
        );
        const service = new GitService(tempDir, tempDir, git);
        const before = (await service.getStatus()).flatMap((file) => file.hunks || []).map((hunk) => hunk.id);
        expect(before).toHaveLength(2);
        expect(before.every((id) => id.includes(':head:'))).toBe(true);

        await git.add('partial.txt');
        fs.appendFileSync(path.join(tempDir, 'partial.txt'), 'appended\n');
        const status = (await service.getStatus()).filter((file) => file.path === 'partial.txt');
        expect(status.map((file) => file.staged)).toEqual([true, false]);
        expect(status[1].hunks).toBeUndefined();
        const after = status[0].hunks!.map((hunk) => hunk.id);
        expect(after).toHaveLength(3);
        expect(after).toEqual(expect.arrayContaining(before));
    });

    it('commits only the change blocks of the target changelist across staged and unstaged edits', async () => {
        fs.writeFileSync(
            path.join(tempDir, 'partial.txt'),
            [
                'one',
                'two',
                'three',
                'four',
                'five',
                'six',
                'seven',
                'eight',
                'nine',
                'ten',
                'eleven',
                'twelve',
                '',
            ].join('\n')
        );
        await git.add('partial.txt');
        await git.commit('Initial commit');

        fs.writeFileSync(
            path.join(tempDir, 'partial.txt'),
            ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', '']
                .map((line) => (line === 'one' ? 'one staged' : line))
                .join('\n')
        );
        await git.add('partial.txt');
        fs.writeFileSync(
            path.join(tempDir, 'partial.txt'),
            ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', '']
                .map((line) => (line === 'one' ? 'one staged' : line === 'ten' ? 'ten later' : line))
                .join('\n')
        );

        const service = new GitService(tempDir, tempDir, git);
        const status = await service.getStatus();
        const hunks = status.flatMap((file) => file.hunks || []);
        const laterHunk = hunks.find((hunk) => hunk.content.includes('ten later'));
        expect(hunks).toHaveLength(2);
        expect(laterHunk).toBeTruthy();

        await service.commitChangelistPlan(
            'Commit first change only',
            false,
            {
                files: ['partial.txt'],
                excludedFiles: [],
                excludedHunkIdsByPath: { 'partial.txt': [laterHunk!.id] },
            },
            status
        );

        const committedContent = await git.show(['HEAD:partial.txt']);
        expect(committedContent).toContain('one staged');
        expect(committedContent).not.toContain('ten later');
        expect(await git.diff(['--cached'])).toBe('');
        expect(await git.diff(['--', 'partial.txt'])).toContain('ten later');
    });

    it('reports a commit view change when a reviewed untracked file is edited again', async () => {
        fs.writeFileSync(path.join(tempDir, 'tracked.txt'), 'base\n');
        await git.add('tracked.txt');
        await git.commit('Initial commit');
        fs.writeFileSync(path.join(tempDir, 'new.txt'), 'first\n');

        const values: Record<string, unknown> = {};
        const workspaceState = {
            get: (key: string) => values[key],
            update: async (key: string, value: unknown) => {
                values[key] = value;
            },
        };
        const reviewed = new ReviewedStateService({ workspaceState } as never, tempDir);
        const service = new GitService(tempDir, tempDir, git, undefined, reviewed);
        await service.refreshStatusCache();
        await reviewed.setReviewed(['new.txt'], true);
        expect((await service.refreshStatusCache()).commitChanged).toBe(false);

        fs.writeFileSync(path.join(tempDir, 'new.txt'), 'second\n');
        expect((await service.refreshStatusCache()).commitChanged).toBe(true);
        expect((await reviewed.apply(await service.getStatusForView()))[0].reviewed).toBeUndefined();
    });

    it('commits a staged rename from a changelist plan without leaving the old path behind', async () => {
        fs.writeFileSync(path.join(tempDir, 'old.txt'), 'one\ntwo\nthree\n');
        fs.writeFileSync(path.join(tempDir, 'other.txt'), 'base\n');
        await git.add(['old.txt', 'other.txt']);
        await git.commit('Initial commit');

        await git.mv('old.txt', 'new.txt');
        fs.writeFileSync(path.join(tempDir, 'new.txt'), 'one\ntwo changed\nthree\n');
        fs.writeFileSync(path.join(tempDir, 'other.txt'), 'later\n');

        const service = new GitService(tempDir, tempDir, git);
        const status = await service.getStatus();
        const renamed = status.find((file) => file.path === 'new.txt' && file.staged);
        expect(renamed?.originalPath).toBe('old.txt');
        const renamedHunks = status.filter((file) => file.path === 'new.txt').flatMap((file) => file.hunks || []);
        expect(renamedHunks).toHaveLength(1);
        expect(renamedHunks[0].fileHeader).not.toContain('rename from');

        await service.commitChangelistPlan(
            'Rename file',
            false,
            { files: ['new.txt'], excludedFiles: ['other.txt'], excludedHunkIdsByPath: {} },
            status
        );

        expect(await git.raw(['ls-tree', '--name-only', 'HEAD'])).toBe('new.txt\nother.txt\n');
        expect(await git.show(['HEAD:new.txt'])).toBe('one\ntwo changed\nthree\n');
        expect(await git.show(['HEAD:other.txt'])).toBe('base\n');
        expect(await git.diff(['--cached', '--name-only'])).toBe('');
    });

    it('removes a rename source from the commit even when the old path was re-created', async () => {
        fs.writeFileSync(path.join(tempDir, 'old.txt'), 'one\n');
        await git.add('old.txt');
        await git.commit('Initial commit');

        await git.mv('old.txt', 'new.txt');
        fs.writeFileSync(path.join(tempDir, 'old.txt'), 'unrelated new content\n');

        const service = new GitService(tempDir, tempDir, git);
        const status = await service.getStatus();
        await service.commitChangelistPlan(
            'Rename only',
            false,
            { files: ['new.txt'], excludedFiles: ['old.txt'], excludedHunkIdsByPath: {} },
            status
        );

        expect(await git.raw(['ls-tree', '--name-only', 'HEAD'])).toBe('new.txt\n');
        expect(fs.readFileSync(path.join(tempDir, 'old.txt'), 'utf8')).toBe('unrelated new content\n');
    });

    it('commits deleted files from a changelist plan', async () => {
        fs.mkdirSync(path.join(tempDir, 'src'));
        fs.writeFileSync(path.join(tempDir, 'src', 'deleted.txt'), 'base\n');
        await git.add('src/deleted.txt');
        await git.commit('Initial commit');

        fs.rmSync(path.join(tempDir, 'src', 'deleted.txt'));

        const service = new GitService(tempDir, tempDir, git);
        const status = await service.getStatus();
        const deletedStatus = status.find((file) => file.path === 'src/deleted.txt' && file.status === 'D');
        expect(deletedStatus).toBeTruthy();
        expect(deletedStatus?.hunks).toHaveLength(1);
        expect(deletedStatus?.hunks?.[0]).toMatchObject({
            oldStart: 1,
            oldLineCount: 1,
            newStart: 0,
            newLineCount: 0,
        });

        await service.commitChangelistPlan(
            'Delete tracked file',
            false,
            {
                files: ['src/deleted.txt'],
                excludedFiles: [],
                excludedHunkIdsByPath: {},
            },
            status
        );

        const headNameStatus = await git.show(['--name-status', '--format=', 'HEAD']);
        expect(headNameStatus.trim()).toBe('D\tsrc/deleted.txt');
    });

    it('does not open untracked content during status refresh and reads only the requested file', async () => {
        fs.writeFileSync(path.join(tempDir, 'tracked.txt'), 'base\n');
        await git.add('tracked.txt');
        await git.commit('Initial commit');
        fs.mkdirSync(path.join(tempDir, 'dependencies'));
        for (let i = 0; i < 200; i++) {
            fs.writeFileSync(path.join(tempDir, 'dependencies', `${i}.txt`), 'dependency\n');
        }
        const service = new GitService(tempDir, tempDir, git);
        const open = vi.spyOn(fs.promises, 'open');
        const readFile = vi.spyOn(fs.promises, 'readFile');
        try {
            const status = await service.getStatus();
            expect(status).toHaveLength(200);
            expect(status.every((file) => file.hunks === undefined)).toBe(true);
            expect(open).not.toHaveBeenCalled();
            expect(readFile).not.toHaveBeenCalled();
            const [file] = await service.getFileStatusWithHunks('dependencies/0.txt', status);
            expect(file.hunks).toHaveLength(1);
            expect(open).toHaveBeenCalledTimes(1);
            expect(open.mock.calls[0][0]).toBe(fs.realpathSync(path.join(tempDir, 'dependencies/0.txt')));
        } finally {
            open.mockRestore();
            readFile.mockRestore();
        }
    });

    it('keeps large, binary and missing untracked files out of editor hunk parsing', async () => {
        const service = new GitService(tempDir, tempDir, git);
        fs.writeFileSync(path.join(tempDir, 'large.txt'), Buffer.alloc(1024 * 1024 + 1, 65));
        fs.writeFileSync(path.join(tempDir, 'binary.bin'), Buffer.from([65, 0, 66]));
        for (const name of ['large.txt', 'binary.bin', 'missing.txt']) {
            const status: FileStatus[] = [{ path: name, status: '?', staged: false }];
            const [file] = await service.getFileStatusWithHunks(name, status);
            expect(file.path).toBe(name);
            expect(file.hunks).toBeUndefined();
        }
    });

    it('commits untracked files from a changelist plan', async () => {
        fs.mkdirSync(path.join(tempDir, 'src'));
        fs.writeFileSync(path.join(tempDir, 'tracked.txt'), 'base\n');
        await git.add('tracked.txt');
        await git.commit('Initial commit');

        fs.writeFileSync(path.join(tempDir, 'src', 'new.txt'), 'new\n');

        const service = new GitService(tempDir, tempDir, git);
        const status = await service.getStatus();
        const untrackedStatus = status.find((file) => file.path === 'src/new.txt' && file.status === '?');
        expect(untrackedStatus).toBeTruthy();
        expect(untrackedStatus?.hunks).toBeUndefined();
        const [editorStatus] = await service.getFileStatusWithHunks('src/new.txt', status);
        expect(editorStatus.hunks).toHaveLength(1);
        expect(untrackedStatus?.hunks).toBeUndefined();
        expect(editorStatus.hunks?.[0]).toMatchObject({
            oldStart: 0,
            oldLineCount: 0,
            newStart: 1,
            newLineCount: 2,
        });

        await service.commitChangelistPlan(
            'Add untracked file',
            false,
            {
                files: ['src/new.txt'],
                excludedFiles: [],
                excludedHunkIdsByPath: {},
            },
            status
        );

        const headNameStatus = await git.show(['--name-status', '--format=', 'HEAD']);
        expect(headNameStatus.trim()).toBe('A\tsrc/new.txt');
    });

    it('does not apply excluded hunks for files outside the changelist plan', async () => {
        fs.mkdirSync(path.join(tempDir, 'src'));
        fs.writeFileSync(path.join(tempDir, 'src', 'active.txt'), 'base\n');
        fs.writeFileSync(path.join(tempDir, 'src', 'delete-on-feature.txt'), 'delete me\n');
        await git.add(['src/active.txt', 'src/delete-on-feature.txt']);
        await git.commit('Initial commit');

        fs.writeFileSync(path.join(tempDir, 'src', 'active.txt'), 'changed\n');
        fs.rmSync(path.join(tempDir, 'src', 'delete-on-feature.txt'));

        const service = new GitService(tempDir, tempDir, git);
        const status = await service.getStatus();
        const deletedStatus = status.find((file) => file.path === 'src/delete-on-feature.txt' && file.status === 'D');
        expect(deletedStatus?.hunks).toHaveLength(1);

        await service.commitChangelistPlan(
            'Commit active file only',
            false,
            {
                files: ['src/active.txt'],
                excludedFiles: ['src/delete-on-feature.txt'],
                excludedHunkIdsByPath: {
                    'src/delete-on-feature.txt': [deletedStatus!.hunks![0].id],
                },
            },
            status
        );

        const headNameStatus = await git.show(['--name-status', '--format=', 'HEAD']);
        expect(headNameStatus.trim()).toBe('M\tsrc/active.txt');
    });

    it('commits the existing index without expanding partial staging', async () => {
        fs.writeFileSync(
            path.join(tempDir, 'partial.txt'),
            [
                'one',
                'two',
                'three',
                'four',
                'five',
                'six',
                'seven',
                'eight',
                'nine',
                'ten',
                'eleven',
                'twelve',
                '',
            ].join('\n')
        );
        await git.add('partial.txt');
        await git.commit('Initial commit');

        fs.writeFileSync(
            path.join(tempDir, 'partial.txt'),
            [
                'one staged',
                'two',
                'three',
                'four',
                'five',
                'six',
                'seven',
                'eight',
                'nine',
                'ten unstaged',
                'eleven',
                'twelve',
                '',
            ].join('\n')
        );

        const partialPatch = path.join(tempDir, 'partial.patch');
        fs.writeFileSync(
            partialPatch,
            [
                'diff --git a/partial.txt b/partial.txt',
                'index 1111111..2222222 100644',
                '--- a/partial.txt',
                '+++ b/partial.txt',
                '@@ -1,4 +1,4 @@',
                '-one',
                '+one staged',
                ' two',
                ' three',
                ' four',
                '',
            ].join('\n')
        );
        await git.raw(['apply', '--cached', partialPatch]);

        const service = new GitService(tempDir, tempDir, git);
        await service.commit('Commit staged hunk only');

        const committedContent = await git.show(['HEAD:partial.txt']);
        expect(committedContent).toContain('one staged');
        expect(committedContent).toContain('ten\n');
        expect(committedContent).not.toContain('ten unstaged');

        const worktreeDiff = await git.diff(['--', 'partial.txt']);
        expect(worktreeDiff).toContain('ten unstaged');
    });

    it('returns only indexed changes when building a staged scoped diff', async () => {
        fs.writeFileSync(
            path.join(tempDir, 'partial.txt'),
            [
                'one',
                'two',
                'three',
                'four',
                'five',
                'six',
                'seven',
                'eight',
                'nine',
                'ten',
                'eleven',
                'twelve',
                '',
            ].join('\n')
        );
        await git.add('partial.txt');
        await git.commit('Initial commit');

        fs.writeFileSync(
            path.join(tempDir, 'partial.txt'),
            [
                'one staged',
                'two',
                'three',
                'four',
                'five',
                'six',
                'seven',
                'eight',
                'nine',
                'ten unstaged',
                'eleven',
                'twelve',
                '',
            ].join('\n')
        );

        const partialPatch = path.join(tempDir, 'partial.patch');
        fs.writeFileSync(
            partialPatch,
            [
                'diff --git a/partial.txt b/partial.txt',
                'index 1111111..2222222 100644',
                '--- a/partial.txt',
                '+++ b/partial.txt',
                '@@ -1,4 +1,4 @@',
                '-one',
                '+one staged',
                ' two',
                ' three',
                ' four',
                '',
            ].join('\n')
        );
        await git.raw(['apply', '--cached', partialPatch]);

        const service = new GitService(tempDir, tempDir, git);
        const diff = await service.getStagedDiffForFiles(['partial.txt']);

        expect(diff).toContain('+one staged');
        expect(diff).not.toContain('ten unstaged');
    });

    it('returns only worktree changes when building an unstaged scoped diff', async () => {
        fs.writeFileSync(
            path.join(tempDir, 'partial.txt'),
            [
                'one',
                'two',
                'three',
                'four',
                'five',
                'six',
                'seven',
                'eight',
                'nine',
                'ten',
                'eleven',
                'twelve',
                '',
            ].join('\n')
        );
        await git.add('partial.txt');
        await git.commit('Initial commit');

        fs.writeFileSync(
            path.join(tempDir, 'partial.txt'),
            [
                'one staged',
                'two',
                'three',
                'four',
                'five',
                'six',
                'seven',
                'eight',
                'nine',
                'ten unstaged',
                'eleven',
                'twelve',
                '',
            ].join('\n')
        );

        const partialPatch = path.join(tempDir, 'partial.patch');
        fs.writeFileSync(
            partialPatch,
            [
                'diff --git a/partial.txt b/partial.txt',
                'index 1111111..2222222 100644',
                '--- a/partial.txt',
                '+++ b/partial.txt',
                '@@ -1,4 +1,4 @@',
                '-one',
                '+one staged',
                ' two',
                ' three',
                ' four',
                '',
            ].join('\n')
        );
        await git.raw(['apply', '--cached', partialPatch]);

        const service = new GitService(tempDir, tempDir, git);
        const diff = await service.getUnstagedDiffForFiles(['partial.txt']);

        expect(diff).toContain('+ten unstaged');
        expect(diff).not.toContain('one staged');
    });

    it('amends only the message when files is an empty array', async () => {
        fs.writeFileSync(path.join(tempDir, 'initial.txt'), 'initial\n');
        await git.add('initial.txt');
        await git.commit('Initial commit');

        fs.writeFileSync(path.join(tempDir, 'staged.txt'), 'staged\n');
        await git.add('staged.txt');

        const service = new GitService(tempDir, tempDir, git);
        await service.commitAmend('Reword initial commit', []);

        const headMessage = await git.raw(['log', '-1', '--format=%B']);
        expect(headMessage.trim()).toBe('Reword initial commit');

        await expect(git.show(['HEAD:staged.txt'])).rejects.toBeTruthy();
        const status = await git.status();
        expect(status.files.some((file) => file.path === 'staged.txt' && file.index === 'A')).toBe(true);
    });

    it('rewords HEAD without including staged index changes', async () => {
        fs.writeFileSync(path.join(tempDir, 'initial.txt'), 'initial\n');
        await git.add('initial.txt');
        await git.commit('Initial commit');

        fs.writeFileSync(path.join(tempDir, 'staged.txt'), 'staged\n');
        await git.add('staged.txt');

        const service = new GitService(tempDir, tempDir, git);
        const headHash = await git.revparse(['HEAD']);
        await service.rewordCommit(headHash.trim(), 'Reword via log action');

        const headMessage = await git.raw(['log', '-1', '--format=%B']);
        expect(headMessage.trim()).toBe('Reword via log action');

        await expect(git.show(['HEAD:staged.txt'])).rejects.toBeTruthy();
        const status = await git.status();
        expect(status.files.some((file) => file.path === 'staged.txt' && file.index === 'A')).toBe(true);
    });

    it('rewords HEAD with a multiline commit message', async () => {
        fs.writeFileSync(path.join(tempDir, 'initial.txt'), 'initial\n');
        await git.add('initial.txt');
        await git.commit('Initial commit');

        const service = new GitService(tempDir, tempDir, git);
        const headHash = await git.revparse(['HEAD']);
        const message = [
            'Reword with body',
            '',
            'Explain the change in detail.',
            '',
            'Signed-off-by: Intelli Git <intelli-git@example.com>',
        ].join('\n');

        await service.rewordCommit(headHash.trim(), message);

        const headMessage = await git.raw(['log', '-1', '--format=%B']);
        expect(headMessage.trim()).toBe(message);
    });
});

describe('GitService mutation change events', () => {
    let tempDir: string;
    let git: SimpleGit;

    beforeEach(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intelli-git-events-test-'));
        git = simpleGit(tempDir);
        await git.init();
        await git.addConfig('user.name', 'Test User');
        await git.addConfig('user.email', 'test@example.com');
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('fires after stage and unstage mutations', async () => {
        fs.writeFileSync(path.join(tempDir, 'tracked.txt'), 'base\n');
        await git.add('tracked.txt');
        await git.commit('Initial commit');
        fs.writeFileSync(path.join(tempDir, 'tracked.txt'), 'changed\n');

        const service = new GitService(tempDir, tempDir, git);
        let fireCount = 0;
        service.onDidChange(() => fireCount++);

        await service.stageFile('tracked.txt');
        await service.unstageFile('tracked.txt');

        expect(fireCount).toBe(2);
    });

    it('fires after stash mutations', async () => {
        fs.writeFileSync(path.join(tempDir, 'tracked.txt'), 'base\n');
        await git.add('tracked.txt');
        await git.commit('Initial commit');
        fs.writeFileSync(path.join(tempDir, 'tracked.txt'), 'changed\n');

        const service = new GitService(tempDir, tempDir, git);
        let fireCount = 0;
        service.onDidChange(() => fireCount++);

        await service.stash('test stash');

        expect(fireCount).toBe(1);
    });

    it('fires after committing a changelist plan', async () => {
        fs.writeFileSync(path.join(tempDir, 'tracked.txt'), 'base\n');
        await git.add('tracked.txt');
        await git.commit('Initial commit');
        fs.writeFileSync(path.join(tempDir, 'tracked.txt'), 'changed\n');

        const service = new GitService(tempDir, tempDir, git);
        const status = await service.getStatus();
        let fireCount = 0;
        service.onDidChange(() => fireCount++);

        await service.commitChangelistPlan(
            'Commit active changelist',
            false,
            {
                files: ['tracked.txt'],
                excludedFiles: [],
                excludedHunkIdsByPath: {},
            },
            status
        );

        expect(fireCount).toBe(1);
    });

    it('fires after applying a patch through the public mutation API', async () => {
        fs.writeFileSync(path.join(tempDir, 'tracked.txt'), 'base\n');
        await git.add('tracked.txt');
        await git.commit('Initial commit');
        fs.writeFileSync(path.join(tempDir, 'tracked.txt'), 'changed\n');

        const patch = await git.diff(['--', 'tracked.txt']);
        await git.checkout(['--', 'tracked.txt']);

        const service = new GitService(tempDir, tempDir, git);
        let fireCount = 0;
        service.onDidChange(() => fireCount++);

        await service.applyPatch(patch);

        expect(fireCount).toBe(1);
    });

    it('fires after branch switch mutations', async () => {
        fs.writeFileSync(path.join(tempDir, 'tracked.txt'), 'base\n');
        await git.add('tracked.txt');
        await git.commit('Initial commit');
        const initialBranch = (await git.branch()).current;
        await git.checkoutLocalBranch('feature');
        await git.checkout(initialBranch);

        const service = new GitService(tempDir, tempDir, git);
        let fireCount = 0;
        service.onDidChange(() => fireCount++);

        await service.branchRemote.switchBranch('feature');

        expect(fireCount).toBe(1);
    });
});

describe('GitService branch remote workflows', () => {
    let tempDir: string;
    let remoteDir: string;
    let git: SimpleGit;

    beforeEach(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intelli-git-branch-test-'));
        remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intelli-git-remote-test-'));
        git = simpleGit(tempDir);
        await git.init();
        await git.addConfig('user.name', 'Test User');
        await git.addConfig('user.email', 'test@example.com');
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
        fs.rmSync(remoteDir, { recursive: true, force: true });
    });

    async function writeFileAndCommit(relativePath: string, content: string, message: string): Promise<string> {
        fs.writeFileSync(path.join(tempDir, relativePath), content);
        await git.add(relativePath);
        await git.commit(message);
        return (await git.revparse(['HEAD'])).trim();
    }

    async function prepareRestorableDirtyState(): Promise<void> {
        fs.writeFileSync(path.join(tempDir, 'staged.txt'), 'staged local\n');
        await git.add('staged.txt');
        fs.writeFileSync(path.join(tempDir, 'notes.txt'), 'untracked local\n');
    }

    async function expectRestorableDirtyState(): Promise<void> {
        const status = await git.status();
        expect(status.staged).toContain('staged.txt');
        expect(status.not_added).toContain('notes.txt');
        expect(fs.readFileSync(path.join(tempDir, 'staged.txt'), 'utf8')).toBe('staged local\n');
        expect(fs.readFileSync(path.join(tempDir, 'notes.txt'), 'utf8')).toBe('untracked local\n');
        expect((await git.stashList()).all).toHaveLength(0);
    }

    it('switches branches through temporary stash and restores dirty files', async () => {
        fs.writeFileSync(path.join(tempDir, 'tracked.txt'), 'base\n');
        await git.add('tracked.txt');
        await git.commit('Initial commit');
        await git.branch(['-M', 'main']);
        await git.checkoutLocalBranch('feature');
        await git.checkout('main');

        fs.writeFileSync(path.join(tempDir, 'notes.txt'), 'local only\n');

        const service = new GitService(tempDir, tempDir, git);
        await service.branchRemote.switchBranch('feature');

        expect((await git.branch()).current).toBe('feature');
        expect(fs.readFileSync(path.join(tempDir, 'notes.txt'), 'utf8')).toBe('local only\n');
    });

    it('summarizes tracked and untracked files for destructive operation previews', async () => {
        await writeFileAndCommit('tracked.txt', 'base\n', 'Initial commit');
        fs.writeFileSync(path.join(tempDir, 'tracked.txt'), 'changed\n');
        fs.writeFileSync(path.join(tempDir, 'staged.txt'), 'staged\n');
        await git.add('staged.txt');
        fs.writeFileSync(path.join(tempDir, 'notes.txt'), 'untracked\n');

        const service = new GitService(tempDir, tempDir, git);
        const preview = await service.getLocalChangePreview();

        expect(preview.trackedCount).toBe(2);
        expect(preview.untrackedCount).toBe(1);
        expect(preview.sampleFiles).toEqual(expect.arrayContaining(['staged.txt', 'tracked.txt']));
        expect(preview.sampleFiles).not.toContain('notes.txt');
    });

    it('merges through temporary stash and restores staged and untracked files', async () => {
        await writeFileAndCommit('base.txt', 'base\n', 'Initial commit');
        await git.branch(['-M', 'main']);
        await git.checkoutLocalBranch('feature');
        await writeFileAndCommit('feature.txt', 'feature\n', 'Feature commit');
        await git.checkout('main');
        await prepareRestorableDirtyState();

        const service = new GitService(tempDir, tempDir, git);
        await service.branchRemote.merge('feature');

        expect(fs.readFileSync(path.join(tempDir, 'feature.txt'), 'utf8')).toBe('feature\n');
        await expectRestorableDirtyState();
    });

    it('checks out commits through temporary stash and restores staged and untracked files', async () => {
        const initialCommit = await writeFileAndCommit('base.txt', 'base\n', 'Initial commit');
        await writeFileAndCommit('second.txt', 'second\n', 'Second commit');
        await prepareRestorableDirtyState();

        const service = new GitService(tempDir, tempDir, git);
        await service.branchRemote.checkoutCommit(initialCommit);

        expect((await git.revparse(['HEAD'])).trim()).toBe(initialCommit);
        await expectRestorableDirtyState();
    });

    it('cherry-picks through temporary stash and restores staged and untracked files', async () => {
        await writeFileAndCommit('base.txt', 'base\n', 'Initial commit');
        await git.branch(['-M', 'main']);
        await git.checkoutLocalBranch('feature');
        const pickedCommit = await writeFileAndCommit('picked.txt', 'picked\n', 'Picked commit');
        await git.checkout('main');
        await prepareRestorableDirtyState();

        const service = new GitService(tempDir, tempDir, git);
        await service.branchRemote.cherryPick(pickedCommit);

        expect(fs.readFileSync(path.join(tempDir, 'picked.txt'), 'utf8')).toBe('picked\n');
        await expectRestorableDirtyState();
    });

    it('reverts through temporary stash and restores staged and untracked files', async () => {
        await writeFileAndCommit('base.txt', 'base\n', 'Initial commit');
        const revertedCommit = await writeFileAndCommit('revert-target.txt', 'remove me\n', 'Revert target');
        await prepareRestorableDirtyState();

        const service = new GitService(tempDir, tempDir, git);
        await service.branchRemote.revert(revertedCommit);

        expect(fs.existsSync(path.join(tempDir, 'revert-target.txt'))).toBe(false);
        await expectRestorableDirtyState();
    });

    it('keeps the temporary stash discoverable when a protected operation fails', async () => {
        await writeFileAndCommit('base.txt', 'base\n', 'Initial commit');
        await prepareRestorableDirtyState();

        const service = new GitService(tempDir, tempDir, git);
        let thrownError: unknown;
        try {
            await service.branchRemote.merge('missing-branch');
        } catch (e) {
            thrownError = e;
        }

        const message = thrownError instanceof Error ? thrownError.message : String(thrownError);
        expect(message).toMatch(/temporary stash "Intelli Git merge missing-branch:/);
        expect(message).toMatch(/Current Git state:/);
        expect(message).toMatch(/Git error:/);
    });

    it('uses force-with-lease for force push', async () => {
        const push = vi.fn().mockResolvedValue(undefined);
        const notifyChanged = vi.fn();
        const service = new GitBranchRemoteService({
            git: {} as SimpleGit,
            remoteGit: { push } as unknown as SimpleGit,
            gitRoot: tempDir,
            notifyChanged,
            withTemporaryStash: async () => {},
            createEditorGit: () => {
                throw new Error('Not used');
            },
            runMutation: async (operation) => operation(),
            getCommitFiles: async () => [],
        });

        await service.forcePush('origin', 'main:main', { noVerify: true });

        expect(push).toHaveBeenCalledWith('origin', 'main:main', ['--force-with-lease', '--no-verify']);
        expect(notifyChanged).toHaveBeenCalledWith('remote');
    });

    it('pulls with merge through temporary stash protection', async () => {
        const fetch = vi.fn().mockResolvedValue(undefined);
        const merge = vi.fn().mockResolvedValue(undefined);
        const notifyChanged = vi.fn();
        let runMutationCalls = 0;
        const runMutation = async <T>(operation: () => Promise<T>): Promise<T> => {
            runMutationCalls++;
            return operation();
        };
        const withTemporaryStash = vi.fn(async (_operationName: string, operation: () => Promise<void>) => {
            await operation();
        });
        const service = new GitBranchRemoteService({
            git: { merge } as unknown as SimpleGit,
            remoteGit: { fetch } as unknown as SimpleGit,
            gitRoot: tempDir,
            notifyChanged,
            withTemporaryStash,
            createEditorGit: () => {
                throw new Error('Not used');
            },
            runMutation,
            getCommitFiles: async () => [],
        });

        await service.pullWithMerge('origin', 'main');

        expect(runMutationCalls).toBe(1);
        expect(withTemporaryStash).toHaveBeenCalledTimes(1);
        expect(withTemporaryStash.mock.calls[0][0]).toBe('pull origin/main');
        expect(fetch).toHaveBeenCalledWith(['origin', 'main']);
        expect(merge).toHaveBeenCalledWith(['FETCH_HEAD']);
        expect(notifyChanged).not.toHaveBeenCalled();
    });

    it('detects branches that are checked out in another linked worktree', async () => {
        fs.writeFileSync(path.join(tempDir, 'tracked.txt'), 'base\n');
        await git.add('tracked.txt');
        await git.commit('Initial commit');
        await git.branch(['-M', 'main']);
        await git.checkoutLocalBranch('feature');
        await git.checkout('main');

        const linkedWorktreePath = path.join(remoteDir, 'feature-worktree');
        await git.raw(['worktree', 'add', linkedWorktreePath, 'feature']);

        const service = new GitService(tempDir, tempDir, git);
        const usage = await service.branchRemote.getWorktreeBranchUsage('feature');

        expect(usage).toMatchObject({
            branch: 'feature',
            path: fs.realpathSync(linkedWorktreePath),
            pathExists: true,
            isPrunable: false,
        });
        await expect(service.branchRemote.switchBranch('feature')).rejects.toThrow(/already used by worktree/);
    });

    it('prunes missing linked worktrees before retrying checkout', async () => {
        fs.writeFileSync(path.join(tempDir, 'tracked.txt'), 'base\n');
        await git.add('tracked.txt');
        await git.commit('Initial commit');
        await git.branch(['-M', 'main']);
        await git.checkoutLocalBranch('feature');
        await git.checkout('main');

        const linkedWorktreePath = path.join(remoteDir, 'stale-feature-worktree');
        await git.raw(['worktree', 'add', linkedWorktreePath, 'feature']);
        fs.rmSync(linkedWorktreePath, { recursive: true, force: true });

        const service = new GitService(tempDir, tempDir, git);
        await expect(service.branchRemote.getWorktreeBranchUsage('feature')).resolves.toMatchObject({
            branch: 'feature',
            path: path.join(fs.realpathSync(remoteDir), 'stale-feature-worktree'),
            pathExists: false,
        });

        await service.branchRemote.pruneWorktrees();
        await expect(service.branchRemote.getWorktreeBranchUsage('feature')).resolves.toBeUndefined();

        await service.branchRemote.switchBranch('feature');
        expect((await git.branch()).current).toBe('feature');
    });

    it('lists linked worktrees with active, dirty, and missing state', async () => {
        fs.writeFileSync(path.join(tempDir, 'tracked.txt'), 'base\n');
        await git.add('tracked.txt');
        await git.commit('Initial commit');
        await git.branch(['-M', 'main']);
        await git.checkoutLocalBranch('feature');
        await git.checkout('main');

        const linkedWorktreePath = path.join(remoteDir, 'feature-worktree');
        await git.raw(['worktree', 'add', linkedWorktreePath, 'feature']);
        fs.writeFileSync(path.join(linkedWorktreePath, 'tracked.txt'), 'dirty\n');

        const staleWorktreePath = path.join(remoteDir, 'stale-worktree');
        await git.checkoutLocalBranch('stale-feature');
        await git.checkout('main');
        await git.raw(['worktree', 'add', staleWorktreePath, 'stale-feature']);
        fs.rmSync(staleWorktreePath, { recursive: true, force: true });

        const service = new GitService(tempDir, tempDir, git);
        const worktrees = await service.branchRemote.getWorktrees(tempDir);

        expect(worktrees).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    branch: 'main',
                    path: fs.realpathSync(tempDir),
                    isMain: true,
                    isCurrent: true,
                    isActiveRepository: true,
                    pathExists: true,
                    isDirty: false,
                }),
                expect.objectContaining({
                    branch: 'feature',
                    path: fs.realpathSync(linkedWorktreePath),
                    isMain: false,
                    isCurrent: false,
                    pathExists: true,
                    isDirty: true,
                }),
                expect.objectContaining({
                    branch: 'stale-feature',
                    path: path.join(fs.realpathSync(remoteDir), 'stale-worktree'),
                    pathExists: false,
                    isDirty: false,
                }),
            ])
        );
    });

    it('removes clean linked worktrees but blocks dirty worktrees', async () => {
        fs.writeFileSync(path.join(tempDir, 'tracked.txt'), 'base\n');
        await git.add('tracked.txt');
        await git.commit('Initial commit');
        await git.branch(['-M', 'main']);

        await git.checkoutLocalBranch('dirty-feature');
        await git.checkout('main');
        const dirtyWorktreePath = path.join(remoteDir, 'dirty-worktree');
        await git.raw(['worktree', 'add', dirtyWorktreePath, 'dirty-feature']);
        fs.writeFileSync(path.join(dirtyWorktreePath, 'tracked.txt'), 'dirty\n');

        const service = new GitService(tempDir, tempDir, git);
        await expect(service.branchRemote.removeWorktree(dirtyWorktreePath)).rejects.toThrow(/local changes/);

        await git.checkoutLocalBranch('clean-feature');
        await git.checkout('main');
        const cleanWorktreePath = path.join(remoteDir, 'clean-worktree');
        await git.raw(['worktree', 'add', cleanWorktreePath, 'clean-feature']);

        await service.branchRemote.removeWorktree(cleanWorktreePath);

        expect(fs.existsSync(cleanWorktreePath)).toBe(false);
        await expect(service.branchRemote.getWorktreeBranchUsage('clean-feature')).resolves.toBeUndefined();
    });

    it('forces removing dirty linked worktrees when force parameter is true', async () => {
        fs.writeFileSync(path.join(tempDir, 'tracked.txt'), 'base\n');
        await git.add('tracked.txt');
        await git.commit('Initial commit');
        await git.branch(['-M', 'main']);

        await git.checkoutLocalBranch('dirty-feature');
        await git.checkout('main');
        const dirtyWorktreePath = path.join(remoteDir, 'dirty-worktree');
        await git.raw(['worktree', 'add', dirtyWorktreePath, 'dirty-feature']);
        fs.writeFileSync(path.join(dirtyWorktreePath, 'tracked.txt'), 'dirty\n');

        const service = new GitService(tempDir, tempDir, git);
        await service.branchRemote.removeWorktree(dirtyWorktreePath, true);

        expect(fs.existsSync(dirtyWorktreePath)).toBe(false);
        await expect(service.branchRemote.getWorktreeBranchUsage('dirty-feature')).resolves.toBeUndefined();
    });

    it('checks out remote branches as tracking local branches', async () => {
        await simpleGit(remoteDir).init(true);
        fs.writeFileSync(path.join(tempDir, 'tracked.txt'), 'base\n');
        await git.add('tracked.txt');
        await git.commit('Initial commit');
        await git.branch(['-M', 'main']);
        await git.addRemote('origin', remoteDir);
        await git.push('origin', 'main');

        await git.checkoutLocalBranch('feature');
        fs.writeFileSync(path.join(tempDir, 'feature.txt'), 'feature\n');
        await git.add('feature.txt');
        await git.commit('Feature commit');
        await git.push('origin', 'feature');
        await git.checkout('main');
        await git.branch(['-D', 'feature']);

        const service = new GitService(tempDir, tempDir, git);
        await service.branchRemote.checkoutRemoteBranch('origin/feature');

        expect((await git.branch()).current).toBe('feature');
        await expect(service.branchRemote.getUpstreamBranch('feature')).resolves.toBe('origin/feature');
    });

    it('reads merge state from git root when workspace is a repository subdirectory', async () => {
        fs.mkdirSync(path.join(tempDir, 'app'), { recursive: true });
        fs.writeFileSync(path.join(tempDir, 'app', 'tracked.txt'), 'base\n');
        await git.add('app/tracked.txt');
        await git.commit('Initial commit');

        const gitDir = path.join(tempDir, '.git');
        fs.writeFileSync(path.join(gitDir, 'MERGE_HEAD'), '0123456789012345678901234567890123456789\n');
        fs.writeFileSync(path.join(gitDir, 'MERGE_MSG'), 'Merge branch feature\n');

        const service = new GitService(path.join(tempDir, 'app'), tempDir, git);

        await expect(service.branchRemote.getRebaseStatus()).resolves.toBe('merging');
        await expect(service.branchRemote.getRebaseCommitMessage()).resolves.toBe('Merge branch feature');
    });

    it('detects GitHub remotes for log actions', async () => {
        fs.writeFileSync(path.join(tempDir, 'tracked.txt'), 'base\n');
        await git.add('tracked.txt');
        await git.commit('Initial commit');
        await git.addRemote('upstream', 'git@github.com:owner/repo.git');

        const service = new GitService(tempDir, tempDir, git);

        await expect(service.branchRemote.getRemoteProvider()).resolves.toBe('github');
        await expect(service.branchRemote.getGitHubRepositoryUrl()).resolves.toBe('https://github.com/owner/repo');
        await expect(service.branchRemote.getRemoteLinkInfo()).resolves.toMatchObject({
            provider: 'github',
            repositoryUrl: 'https://github.com/owner/repo',
            capabilities: {
                commit: true,
                branch: true,
                file: true,
                compare: true,
            },
        });
        await expect(service.branchRemote.getRemoteCommitUrl('abc123')).resolves.toBe(
            'https://github.com/owner/repo/commit/abc123'
        );
        await expect(service.branchRemote.getRemoteBranchUrl('feature/demo')).resolves.toBe(
            'https://github.com/owner/repo/tree/feature/demo'
        );
        await expect(service.branchRemote.getRemoteFileUrl('main', 'src/index.ts')).resolves.toBe(
            'https://github.com/owner/repo/blob/main/src/index.ts'
        );
        await expect(service.branchRemote.getRemoteCompareUrl('main', 'feature/demo')).resolves.toBe(
            'https://github.com/owner/repo/compare/main...feature/demo'
        );
    });

    it('builds commit links for self-hosted GitLab remotes', async () => {
        await git.addRemote('origin', 'git@gitlab.example.com:group/subgroup/repo.git');

        const service = new GitService(tempDir, tempDir, git);

        await expect(service.branchRemote.getRemoteProvider()).resolves.toBe('gitlab');
        await expect(service.branchRemote.getRemoteLinkInfo()).resolves.toMatchObject({
            provider: 'gitlab',
            repositoryUrl: 'https://gitlab.example.com/group/subgroup/repo',
            capabilities: {
                commit: true,
                branch: true,
                file: true,
                compare: true,
            },
        });
        await expect(service.branchRemote.getRemoteCommitUrl('abc123')).resolves.toBe(
            'https://gitlab.example.com/group/subgroup/repo/-/commit/abc123'
        );
        await expect(service.branchRemote.getRemoteBranchUrl('feature/demo')).resolves.toBe(
            'https://gitlab.example.com/group/subgroup/repo/-/tree/feature/demo'
        );
        await expect(service.branchRemote.getRemoteFileUrl('main', 'src/index.ts')).resolves.toBe(
            'https://gitlab.example.com/group/subgroup/repo/-/blob/main/src/index.ts'
        );
        await expect(service.branchRemote.getRemoteCompareUrl('main', 'feature/demo')).resolves.toBe(
            'https://gitlab.example.com/group/subgroup/repo/-/compare/main...feature/demo'
        );
    });

    it('builds provider-aware commit links for Bitbucket and Azure DevOps remotes', async () => {
        await git.addRemote('origin', 'https://bitbucket.org/workspace/repo.git');

        let service = new GitService(tempDir, tempDir, git);
        await expect(service.branchRemote.getRemoteProvider()).resolves.toBe('bitbucket');
        await expect(service.branchRemote.getRemoteLinkInfo()).resolves.toMatchObject({
            provider: 'bitbucket',
            repositoryUrl: 'https://bitbucket.org/workspace/repo',
            capabilities: {
                commit: true,
                branch: true,
                file: true,
                compare: false,
            },
        });
        await expect(service.branchRemote.getRemoteCommitUrl('abc123')).resolves.toBe(
            'https://bitbucket.org/workspace/repo/commits/abc123'
        );
        await expect(service.branchRemote.getRemoteBranchUrl('feature/demo')).resolves.toBe(
            'https://bitbucket.org/workspace/repo/src/feature/demo/'
        );
        await expect(service.branchRemote.getRemoteFileUrl('main', 'src/index.ts')).resolves.toBe(
            'https://bitbucket.org/workspace/repo/src/main/src/index.ts'
        );
        await expect(service.branchRemote.getRemoteCompareUrl('main', 'feature/demo')).resolves.toBeUndefined();

        await git.removeRemote('origin');
        await git.addRemote('origin', 'git@ssh.dev.azure.com:v3/org/project/repo');

        service = new GitService(tempDir, tempDir, git);
        await expect(service.branchRemote.getRemoteProvider()).resolves.toBe('azure');
        await expect(service.branchRemote.getRemoteLinkInfo()).resolves.toMatchObject({
            provider: 'azure',
            repositoryUrl: 'https://dev.azure.com/org/project/_git/repo',
            capabilities: {
                commit: true,
                branch: true,
                file: true,
                compare: false,
            },
        });
        await expect(service.branchRemote.getRemoteCommitUrl('abc123')).resolves.toBe(
            'https://dev.azure.com/org/project/_git/repo/commit/abc123'
        );
        await expect(service.branchRemote.getRemoteBranchUrl('feature/demo')).resolves.toBe(
            'https://dev.azure.com/org/project/_git/repo?version=GBfeature%2Fdemo'
        );
        await expect(service.branchRemote.getRemoteFileUrl('main', 'src/index.ts')).resolves.toBe(
            'https://dev.azure.com/org/project/_git/repo?path=%2Fsrc%2Findex.ts&version=GBmain'
        );
        await expect(service.branchRemote.getRemoteFileUrl('abc1234', 'src/index.ts')).resolves.toBe(
            'https://dev.azure.com/org/project/_git/repo?path=%2Fsrc%2Findex.ts&version=GCabc1234'
        );
        await expect(service.branchRemote.getRemoteCompareUrl('main', 'feature/demo')).resolves.toBeUndefined();
    });

    it('treats unrecognized remotes as unsupported remote links', async () => {
        await git.addRemote('origin', 'git@example.com:owner/repo.git');

        const service = new GitService(tempDir, tempDir, git);

        await expect(service.branchRemote.getRemoteProvider()).resolves.toBe('unknown');
        await expect(service.branchRemote.getRemoteLinkInfo()).resolves.toEqual({
            provider: 'unknown',
            capabilities: {
                commit: false,
                branch: false,
                file: false,
                compare: false,
            },
        });
        await expect(service.branchRemote.getRemoteCommitUrl('abc123')).resolves.toBeUndefined();
    });

    it('builds push preview data for a new remote branch', async () => {
        await simpleGit(remoteDir).init(true);
        fs.writeFileSync(path.join(tempDir, 'tracked.txt'), 'base\n');
        await git.add('tracked.txt');
        await git.commit('Initial commit');
        await git.branch(['-M', 'main']);
        await git.addRemote('origin', remoteDir);
        await git.push('origin', 'main');

        await git.checkoutLocalBranch('feature');
        fs.writeFileSync(path.join(tempDir, 'feature.txt'), 'feature\n');
        await git.add('feature.txt');
        await git.commit('Feature commit');

        const service = new GitService(tempDir, tempDir, git);
        const preview = await service.branchRemote.getPushCommits({
            remote: 'origin',
            branch: 'feature',
        });

        expect(preview.totalCount).toBe(1);
        expect(preview.hasMore).toBe(false);
        expect(preview.commits).toHaveLength(1);
        expect(preview.commits[0].subject).toBe('Feature commit');
        expect(preview.commits[0].files.map((file) => file.path)).toEqual(['feature.txt']);
    });
});

describe('GitService binary revision content', () => {
    it('reads HEAD, index, and stash without UTF-8 conversion', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'intelli-git-image-'));
        try {
            const git = simpleGit(root);
            await git.init();
            await git.addConfig('user.name', 'Intelli Git Test');
            await git.addConfig('user.email', 'test@example.com');
            await git.addConfig('commit.gpgsign', 'false');
            const before = Buffer.from([0x89, 0xff, 0, 0x80]);
            const after = Buffer.from([0xff, 0xd8, 0, 0x81]);
            fs.writeFileSync(path.join(root, 'image.png'), before);
            await git.add('image.png');
            await git.commit('Add image');
            const service = new GitService(root, root, git);
            fs.writeFileSync(path.join(root, 'image.png'), after);
            await git.add('image.png');
            expect(await service.getFileContentBuffer('HEAD', 'image.png')).toEqual(before);
            expect(await service.getFileContentBuffer('', 'image.png')).toEqual(after);
            expect(await service.getFileContentBuffer('HEAD', 'missing.png')).toBeNull();
            await git.stash();
            expect(await service.getFileContentBuffer('stash@{0}', 'image.png')).toEqual(after);
            expect(await service.getFileContentBuffer('stash@{0}^', 'image.png')).toEqual(before);
            await expect(service.getFileContentBuffer('invalid-ref', 'image.png')).rejects.toThrow();
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
