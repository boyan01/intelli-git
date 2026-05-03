import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import simpleGit, { type SimpleGit } from 'simple-git';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FileStatus } from '@shared/messages';
import { GitService } from './GitService';
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
