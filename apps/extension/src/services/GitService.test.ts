import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import simpleGit, { type SimpleGit } from 'simple-git';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FileStatus } from '@shared/messages';
import { GitService } from './GitService';
import { GitBranchRemoteService } from './GitBranchRemoteService';
import type { InactiveChangesService } from './InactiveChangesService';

interface GitServiceInternals {
    createEditorGit(envOverrides: NodeJS.ProcessEnv): SimpleGit;
}

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
            GIT_EDITOR: 'true'
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
        const firstCanFinish = new Promise<void>(resolve => {
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

        await new Promise(resolve => setTimeout(resolve, 0));
        expect(events).toEqual(['first:start', 'first:nested']);

        releaseFirst?.();
        await Promise.all([first, second]);

        expect(events).toEqual(['first:start', 'first:nested', 'first:end', 'second:start']);
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
        fs.mkdirSync(path.join(tempDir, 'app'), { recursive: true });
        fs.writeFileSync(path.join(tempDir, 'root.txt'), 'base\n');
        fs.writeFileSync(path.join(tempDir, 'app', 'scoped.txt'), 'base\n');
        await git.add(['root.txt', 'app/scoped.txt']);
        await git.commit('Initial commit');

        fs.writeFileSync(path.join(tempDir, 'root.txt'), 'changed\n');
        fs.writeFileSync(path.join(tempDir, 'app', 'scoped.txt'), 'changed\n');

        const workspaceRoot = path.join(tempDir, 'app');
        const service = await GitService.create(workspaceRoot);
        const status = await service.getStatus();

        expect(service.getWorkspaceRoot()).toBe(fs.realpathSync(workspaceRoot));
        expect(service.getGitRoot()).toBe(fs.realpathSync(tempDir));
        expect(status.map(file => file.path)).toEqual(['scoped.txt']);
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

describe('GitService staging inactive changes', () => {
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

    it('skips fully inactive files when staging all tracked changes', async () => {
        fs.writeFileSync(path.join(tempDir, 'active.txt'), 'base\n');
        fs.writeFileSync(path.join(tempDir, 'inactive.txt'), 'base\n');
        await git.add(['active.txt', 'inactive.txt']);
        await git.commit('Initial commit');

        fs.writeFileSync(path.join(tempDir, 'active.txt'), 'active\n');
        fs.writeFileSync(path.join(tempDir, 'inactive.txt'), 'inactive\n');

        const inactiveChangesService = createInactiveChangesService({
            inactiveFiles: new Set(['inactive.txt'])
        });
        const service = new GitService(tempDir, tempDir, git, inactiveChangesService);

        await service.stageTracked();

        const cachedDiff = await git.diff(['--cached', '--name-only']);
        expect(cachedDiff.trim().split('\n')).toEqual(['active.txt']);
    });

    it('keeps inactive hunks out of the index when staging all tracked changes', async () => {
        fs.writeFileSync(path.join(tempDir, 'partial.txt'), [
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
            ''
        ].join('\n'));
        await git.add('partial.txt');
        await git.commit('Initial commit');

        fs.writeFileSync(path.join(tempDir, 'partial.txt'), [
            'one active',
            'two',
            'three',
            'four',
            'five',
            'six',
            'seven',
            'eight',
            'nine',
            'ten inactive',
            'eleven',
            'twelve',
            ''
        ].join('\n'));

        const inactiveHunkIds = new Map<string, string[]>();
        const inactiveChangesService = createInactiveChangesService({ inactiveHunkIds });
        const service = new GitService(tempDir, tempDir, git, inactiveChangesService);
        const partialStatus = (await service.getStatus()).find(file => file.path === 'partial.txt' && !file.staged);
        expect(partialStatus?.hunks).toHaveLength(2);

        inactiveHunkIds.set('partial.txt', [partialStatus!.hunks![1].id]);

        await service.stageTracked();

        const cachedDiff = await git.diff(['--cached', '--', 'partial.txt']);
        expect(cachedDiff).toContain('one active');
        expect(cachedDiff).not.toContain('ten inactive');
    });

    it('stages active change blocks when nearby blocks share one git hunk', async () => {
        fs.writeFileSync(path.join(tempDir, 'shared.txt'), [
            'shared-on-main',
            'main-second-line',
            ''
        ].join('\n'));
        await git.add('shared.txt');
        await git.commit('Initial commit');

        fs.writeFileSync(path.join(tempDir, 'shared.txt'), [
            '',
            '1 let 2414',
            'shared-on-main',
            '12ce',
            'main-second-line',
            '',
            '2',
            '12'
        ].join('\n'));

        const inactiveHunkIds = new Map<string, string[]>();
        const inactiveChangesService = createInactiveChangesService({ inactiveHunkIds });
        const service = new GitService(tempDir, tempDir, git, inactiveChangesService);
        const sharedStatus = (await service.getStatus()).find(file => file.path === 'shared.txt' && !file.staged);
        expect(sharedStatus?.hunks).toHaveLength(3);

        inactiveHunkIds.set('shared.txt', [sharedStatus!.hunks![2].id]);

        await service.stageTracked();

        const cachedDiff = await git.diff(['--cached', '--', 'shared.txt']);
        expect(cachedDiff).toContain('1 let 2414');
        expect(cachedDiff).toContain('12ce');
        expect(cachedDiff).not.toMatch(/^\+2$/m);
        expect(cachedDiff).not.toMatch(/^\+12$/m);
    });

    it('matches a staged inactive hunk after it is removed from the index', async () => {
        fs.writeFileSync(path.join(tempDir, 'staged.txt'), 'base\n');
        await git.add('staged.txt');
        await git.commit('Initial commit');

        fs.writeFileSync(path.join(tempDir, 'staged.txt'), 'changed\n');
        await git.add('staged.txt');

        const inactiveHunkIds = new Map<string, string[]>();
        const inactiveChangesService = createInactiveChangesService({ inactiveHunkIds });
        const service = new GitService(tempDir, tempDir, git, inactiveChangesService);
        const stagedStatus = (await service.getStatus()).find(file => file.path === 'staged.txt' && file.staged);
        expect(stagedStatus?.hunks).toHaveLength(1);

        const stagedHunk = stagedStatus!.hunks![0];
        const worktreeHunkId = stagedHunk.id.replace(':index:', ':worktree:');
        await service.applyPatch(service.buildPatchFromHunks([stagedHunk]), true, true);
        inactiveHunkIds.set('staged.txt', [worktreeHunkId]);

        const worktreeStatus = (await service.getStatus()).find(file => file.path === 'staged.txt' && !file.staged);
        expect(worktreeStatus?.hunks?.[0].id).toBe(worktreeHunkId);
        expect(worktreeStatus?.inactiveHunkIds).toContain(worktreeHunkId);
    });

    it('commits deleted files from a changelist plan', async () => {
        fs.mkdirSync(path.join(tempDir, 'src'));
        fs.writeFileSync(path.join(tempDir, 'src', 'deleted.txt'), 'base\n');
        await git.add('src/deleted.txt');
        await git.commit('Initial commit');

        fs.rmSync(path.join(tempDir, 'src', 'deleted.txt'));

        const service = new GitService(tempDir, tempDir, git);
        const status = await service.getStatus();
        const deletedStatus = status.find(file => file.path === 'src/deleted.txt' && file.status === 'D');
        expect(deletedStatus).toBeTruthy();
        expect(deletedStatus?.hunks).toHaveLength(1);
        expect(deletedStatus?.hunks?.[0]).toMatchObject({
            oldStart: 1,
            oldLineCount: 1,
            newStart: 0,
            newLineCount: 0
        });

        await service.commitChangelistPlan('Delete tracked file', false, {
            files: ['src/deleted.txt'],
            excludedFiles: [],
            excludedHunkIdsByPath: {}
        }, status);

        const headNameStatus = await git.show(['--name-status', '--format=', 'HEAD']);
        expect(headNameStatus.trim()).toBe('D\tsrc/deleted.txt');
    });

    it('commits untracked files from a changelist plan', async () => {
        fs.mkdirSync(path.join(tempDir, 'src'));
        fs.writeFileSync(path.join(tempDir, 'tracked.txt'), 'base\n');
        await git.add('tracked.txt');
        await git.commit('Initial commit');

        fs.writeFileSync(path.join(tempDir, 'src', 'new.txt'), 'new\n');

        const service = new GitService(tempDir, tempDir, git);
        const status = await service.getStatus();
        const untrackedStatus = status.find(file => file.path === 'src/new.txt' && file.status === '?');
        expect(untrackedStatus).toBeTruthy();
        expect(untrackedStatus?.hunks).toHaveLength(1);
        expect(untrackedStatus?.hunks?.[0]).toMatchObject({
            oldStart: 0,
            oldLineCount: 0,
            newStart: 1,
            newLineCount: 2
        });

        await service.commitChangelistPlan('Add untracked file', false, {
            files: ['src/new.txt'],
            excludedFiles: [],
            excludedHunkIdsByPath: {}
        }, status);

        const headNameStatus = await git.show(['--name-status', '--format=', 'HEAD']);
        expect(headNameStatus.trim()).toBe('A\tsrc/new.txt');
    });

    it('commits a staged added file when its worktree deletion is excluded', async () => {
        fs.mkdirSync(path.join(tempDir, 'src'));
        fs.writeFileSync(path.join(tempDir, 'tracked.txt'), 'base\n');
        await git.add('tracked.txt');
        await git.commit('Initial commit');

        fs.writeFileSync(path.join(tempDir, 'src', 'added.txt'), 'new\n');
        await git.add('src/added.txt');
        fs.rmSync(path.join(tempDir, 'src', 'added.txt'));

        const service = new GitService(tempDir, tempDir, git);
        const status = await service.getStatus();
        const stagedAdd = status.find(file => file.path === 'src/added.txt' && file.staged && file.status === 'A');
        const worktreeDelete = status.find(file => file.path === 'src/added.txt' && !file.staged && file.status === 'D');
        expect(stagedAdd?.hunks).toHaveLength(1);
        expect(worktreeDelete?.hunks).toHaveLength(1);

        await service.commitChangelistPlan('Add staged file', false, {
            files: ['src/added.txt'],
            excludedFiles: [],
            excludedHunkIdsByPath: {
                'src/added.txt': [worktreeDelete!.hunks![0].id]
            }
        }, status);

        const headNameStatus = await git.show(['--name-status', '--format=', 'HEAD']);
        expect(headNameStatus.trim()).toBe('A\tsrc/added.txt');
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
        const deletedStatus = status.find(file => file.path === 'src/delete-on-feature.txt' && file.status === 'D');
        expect(deletedStatus?.hunks).toHaveLength(1);

        await service.commitChangelistPlan('Commit active file only', false, {
            files: ['src/active.txt'],
            excludedFiles: ['src/delete-on-feature.txt'],
            excludedHunkIdsByPath: {
                'src/delete-on-feature.txt': [deletedStatus!.hunks![0].id]
            }
        }, status);

        const headNameStatus = await git.show(['--name-status', '--format=', 'HEAD']);
        expect(headNameStatus.trim()).toBe('M\tsrc/active.txt');
    });

    it('commits the existing index without expanding partial staging', async () => {
        fs.writeFileSync(path.join(tempDir, 'partial.txt'), [
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
            ''
        ].join('\n'));
        await git.add('partial.txt');
        await git.commit('Initial commit');

        fs.writeFileSync(path.join(tempDir, 'partial.txt'), [
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
            ''
        ].join('\n'));

        const partialPatch = path.join(tempDir, 'partial.patch');
        fs.writeFileSync(partialPatch, [
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
            ''
        ].join('\n'));
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
        fs.writeFileSync(path.join(tempDir, 'partial.txt'), [
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
            ''
        ].join('\n'));
        await git.add('partial.txt');
        await git.commit('Initial commit');

        fs.writeFileSync(path.join(tempDir, 'partial.txt'), [
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
            ''
        ].join('\n'));

        const partialPatch = path.join(tempDir, 'partial.patch');
        fs.writeFileSync(partialPatch, [
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
            ''
        ].join('\n'));
        await git.raw(['apply', '--cached', partialPatch]);

        const service = new GitService(tempDir, tempDir, git);
        const diff = await service.getStagedDiffForFiles(['partial.txt']);

        expect(diff).toContain('+one staged');
        expect(diff).not.toContain('ten unstaged');
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
        expect(status.files.some(file => file.path === 'staged.txt' && file.index === 'A')).toBe(true);
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
        expect(status.files.some(file => file.path === 'staged.txt' && file.index === 'A')).toBe(true);
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
            'Signed-off-by: Intelli Git <intelli-git@example.com>'
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

        await service.commitChangelistPlan('Commit active changelist', false, {
            files: ['tracked.txt'],
            excludedFiles: [],
            excludedHunkIdsByPath: {}
        }, status);

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
            git: { push } as unknown as SimpleGit,
            gitRoot: tempDir,
            notifyChanged,
            withTemporaryStash: async () => { },
            createEditorGit: () => {
                throw new Error('Not used');
            },
            runMutation: async operation => operation(),
            getCommitFiles: async () => []
        });

        await service.forcePush('origin', 'main:main', { noVerify: true });

        expect(push).toHaveBeenCalledWith('origin', 'main:main', ['--force-with-lease', '--no-verify']);
        expect(notifyChanged).toHaveBeenCalledTimes(1);
    });

    it('pulls with merge through temporary stash protection', async () => {
        const pull = vi.fn().mockResolvedValue(undefined);
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
            git: { pull } as unknown as SimpleGit,
            gitRoot: tempDir,
            notifyChanged,
            withTemporaryStash,
            createEditorGit: () => {
                throw new Error('Not used');
            },
            runMutation,
            getCommitFiles: async () => []
        });

        await service.pullWithMerge('origin', 'main');

        expect(runMutationCalls).toBe(1);
        expect(withTemporaryStash).toHaveBeenCalledTimes(1);
        expect(withTemporaryStash.mock.calls[0][0]).toBe('pull origin/main');
        expect(pull).toHaveBeenCalledWith('origin', 'main');
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
            isPrunable: false
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
            pathExists: false
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

        expect(worktrees).toEqual(expect.arrayContaining([
            expect.objectContaining({
                branch: 'main',
                path: fs.realpathSync(tempDir),
                isCurrent: true,
                isActiveRepository: true,
                pathExists: true,
                isDirty: false
            }),
            expect.objectContaining({
                branch: 'feature',
                path: fs.realpathSync(linkedWorktreePath),
                isCurrent: false,
                pathExists: true,
                isDirty: true
            }),
            expect.objectContaining({
                branch: 'stale-feature',
                path: path.join(fs.realpathSync(remoteDir), 'stale-worktree'),
                pathExists: false,
                isDirty: false
            })
        ]));
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
                compare: true
            }
        });
        await expect(service.branchRemote.getRemoteCommitUrl('abc123')).resolves.toBe('https://github.com/owner/repo/commit/abc123');
        await expect(service.branchRemote.getRemoteBranchUrl('feature/demo')).resolves.toBe('https://github.com/owner/repo/tree/feature/demo');
        await expect(service.branchRemote.getRemoteFileUrl('main', 'src/index.ts')).resolves.toBe('https://github.com/owner/repo/blob/main/src/index.ts');
        await expect(service.branchRemote.getRemoteCompareUrl('main', 'feature/demo')).resolves.toBe('https://github.com/owner/repo/compare/main...feature/demo');
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
                compare: true
            }
        });
        await expect(service.branchRemote.getRemoteCommitUrl('abc123')).resolves.toBe('https://gitlab.example.com/group/subgroup/repo/-/commit/abc123');
        await expect(service.branchRemote.getRemoteBranchUrl('feature/demo')).resolves.toBe('https://gitlab.example.com/group/subgroup/repo/-/tree/feature/demo');
        await expect(service.branchRemote.getRemoteFileUrl('main', 'src/index.ts')).resolves.toBe('https://gitlab.example.com/group/subgroup/repo/-/blob/main/src/index.ts');
        await expect(service.branchRemote.getRemoteCompareUrl('main', 'feature/demo')).resolves.toBe('https://gitlab.example.com/group/subgroup/repo/-/compare/main...feature/demo');
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
                compare: false
            }
        });
        await expect(service.branchRemote.getRemoteCommitUrl('abc123')).resolves.toBe('https://bitbucket.org/workspace/repo/commits/abc123');
        await expect(service.branchRemote.getRemoteBranchUrl('feature/demo')).resolves.toBe('https://bitbucket.org/workspace/repo/src/feature/demo/');
        await expect(service.branchRemote.getRemoteFileUrl('main', 'src/index.ts')).resolves.toBe('https://bitbucket.org/workspace/repo/src/main/src/index.ts');
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
                compare: false
            }
        });
        await expect(service.branchRemote.getRemoteCommitUrl('abc123')).resolves.toBe('https://dev.azure.com/org/project/_git/repo/commit/abc123');
        await expect(service.branchRemote.getRemoteBranchUrl('feature/demo')).resolves.toBe('https://dev.azure.com/org/project/_git/repo?version=GBfeature%2Fdemo');
        await expect(service.branchRemote.getRemoteFileUrl('main', 'src/index.ts')).resolves.toBe('https://dev.azure.com/org/project/_git/repo?path=%2Fsrc%2Findex.ts&version=GBmain');
        await expect(service.branchRemote.getRemoteFileUrl('abc1234', 'src/index.ts')).resolves.toBe('https://dev.azure.com/org/project/_git/repo?path=%2Fsrc%2Findex.ts&version=GCabc1234');
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
                compare: false
            }
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
            branch: 'feature'
        });

        expect(preview.totalCount).toBe(1);
        expect(preview.hasMore).toBe(false);
        expect(preview.commits).toHaveLength(1);
        expect(preview.commits[0].subject).toBe('Feature commit');
        expect(preview.commits[0].files.map(file => file.path)).toEqual(['feature.txt']);
    });
});

function createInactiveChangesService(options: {
    inactiveFiles?: Set<string>;
    inactiveHunkIds?: Map<string, string[]>;
}): InactiveChangesService {
    return {
        isInactive(filePath: string): boolean {
            return options.inactiveFiles?.has(filePath) || false;
        },
        getInactiveHunkIds(filePath: string): string[] {
            return options.inactiveHunkIds?.get(filePath) || [];
        },
        syncWithStatus(_status: FileStatus[]): void { }
    } as unknown as InactiveChangesService;
}
