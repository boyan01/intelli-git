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
