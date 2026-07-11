import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const CONTEXT_ONLY_COMMANDS = [
    'intelli-git.repository.removeFromWorkspace',
    'intelli-git.copyCommitHash',
    'intelli-git.stashPop',
    'intelli-git.stashApply',
    'intelli-git.stashDrop',
    'intelli-git.stashShowDiff',
    'intelli-git.branch.checkout',
    'intelli-git.branch.filterLog',
    'intelli-git.branch.rebase',
    'intelli-git.branch.merge',
    'intelli-git.branch.rename',
    'intelli-git.branch.delete',
    'intelli-git.branch.pull',
    'intelli-git.branch.push',
    'intelli-git.branch.update',
    'intelli-git.log.resetSoft',
    'intelli-git.log.resetMixed',
    'intelli-git.log.resetHard',
    'intelli-git.log.checkout',
    'intelli-git.log.openOnGitHub',
    'intelli-git.log.openOnGitLab',
    'intelli-git.log.openOnBitbucket',
    'intelli-git.log.openOnAzureDevOps',
    'intelli-git.log.createBranch',
    'intelli-git.log.cherryPick',
    'intelli-git.log.revert',
    'intelli-git.log.undoCommit',
    'intelli-git.log.editMessage',
    'intelli-git.changelist.openFile',
    'intelli-git.changelist.showDiff',
    'intelli-git.changelist.createPatch.copy',
    'intelli-git.changelist.createPatch.save',
    'intelli-git.changelist.rollback',
    'intelli-git.changelist.stash',
    'intelli-git.changelist.delete',
    'intelli-git.changelist.markInactive',
    'intelli-git.changelist.markActive',
    'intelli-git.changelist.stage',
    'intelli-git.changelist.unstage',
    'intelli-git.changelist.acceptCurrent',
    'intelli-git.changelist.acceptIncoming',
    'intelli-git.changelist.markResolved',
    'intelli-git.merge.acceptLeft',
    'intelli-git.merge.cancelLeft',
    'intelli-git.merge.acceptRight',
    'intelli-git.merge.cancelRight',
    'intelli-git.merge.markReviewed',
    'intelli-git.copyAuthorEmail',
    'intelli-git.sendAuthorEmail',
    'intelli-git.log.file.showDiff',
    'intelli-git.log.file.compareWithLocal',
    'intelli-git.log.file.openRepositoryVersion',
    'intelli-git.log.file.revertChanges',
    'intelli-git.log.file.cherryPickChanges',
    'intelli-git.log.file.createPatch.copy',
    'intelli-git.log.file.createPatch.save',
    'intelli-git.moveHunkToInactive',
    'intelli-git.moveHunkToActive',
    'intelli-git.changelist.renameList',
    'intelli-git.changelist.deleteList',
    'intelli-git.changelist.setActiveList',
    'intelli-git.changelist.moveToList',
    'intelli-git.revealCurrentChangeBlock',
    'intelli-git.hunk.toggleInactive',
    'intelli-git.worktree.switch',
    'intelli-git.worktree.open',
    'intelli-git.worktree.reveal',
    'intelli-git.worktree.prune',
    'intelli-git.worktree.remove',
    'intelli-git.ai.generateMessageFromWebview',
    'intelli-git.ai.generateSubjectFromWebview',
    'intelli-git.ai.generateBodyFromWebview',
    'intelli-git.ai.rewriteSelectionFromWebview',
    'intelli-git.ai.configureProviderFromWebview',
    'intelli-git.ai.selectCopilotModelFromWebview',
    'intelli-git.ai.testProviderFromWebview',
    'intelli-git.ai.openCommitPromptSettingsFromWebview'
];

const GLOBAL_COMMANDS = [
    'intelli-git.refresh',
    'intelli-git.push',
    'intelli-git.showBranchPicker',
    'intelli-git.focusCommitView',
    'intelli-git.focusGitLog',
    'intelli-git.openFeedback',
    'intelli-git.repository.switch',
    'intelli-git.repository.scanWorkspace',
    'intelli-git.repository.add',
    'intelli-git.ai.selectCopilotModel',
    'intelli-git.ai.configureProvider',
    'intelli-git.ai.setApiKey',
    'intelli-git.ai.openCommitPromptSettings'
];

const ACTIVE_REPOSITORY_COMMANDS = [
    'intelli-git.worktrees.toggleDrawer',
    'intelli-git.branch.create',
    'intelli-git.changelist.createList',
    'intelli-git.openLogAtCurrentBlame',
    'intelli-git.showFileHistory'
];

function readPackageJson(): any {
    const packageJsonPath = path.resolve(process.cwd(), 'apps/extension/package.json');
    return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
}

test('context-only commands are hidden from the command palette', () => {
    const packageJson = readPackageJson();
    const commandPalette = packageJson.contributes.menus.commandPalette ?? [];
    const hiddenCommands = new Set(
        commandPalette
            .filter((item: { command?: string; when?: string }) => item.command && item.when === 'false')
            .map((item: { command: string }) => item.command)
    );
    const activeRepositoryCommands = new Set(
        commandPalette
            .filter((item: { command?: string; when?: string }) => item.command && item.when === 'intelli-git.hasActiveRepository')
            .map((item: { command: string }) => item.command)
    );

    for (const command of CONTEXT_ONLY_COMMANDS) {
        assert.equal(hiddenCommands.has(command), true, `${command} should be hidden from the Command Palette`);
    }

    for (const command of GLOBAL_COMMANDS) {
        assert.equal(hiddenCommands.has(command), false, `${command} should stay visible in the Command Palette`);
        assert.equal(activeRepositoryCommands.has(command), false, `${command} should not require an active repository`);
    }

    for (const command of ACTIVE_REPOSITORY_COMMANDS) {
        assert.equal(hiddenCommands.has(command), false, `${command} should stay available for repositories`);
        assert.equal(activeRepositoryCommands.has(command), true, `${command} should require an active repository`);
    }
});

test('remote commit link commands are scoped by detected provider', () => {
    const packageJson = readPackageJson();
    const webviewContext = packageJson.contributes.menus['webview/context'] ?? [];

    const expectedProviders: Record<string, string> = {
        'intelli-git.log.openOnGitHub': 'github',
        'intelli-git.log.openOnGitLab': 'gitlab',
        'intelli-git.log.openOnBitbucket': 'bitbucket',
        'intelli-git.log.openOnAzureDevOps': 'azure'
    };

    for (const [command, provider] of Object.entries(expectedProviders)) {
        const item = webviewContext.find((entry: { command?: string }) => entry.command === command);
        assert.ok(item, `${command} should be registered in the Git Log context menu`);
        assert.equal(
            item.when,
            `webviewSection == 'gitLogCommit' && intelli-git.remoteLink.commit == true && intelli-git.gitRemoteProvider == '${provider}'`
        );
        assert.equal(item.group, '9_external@1');
    }
});

test('mark resolved is available for resolved conflict groups only', () => {
    const packageJson = readPackageJson();
    const webviewContext = packageJson.contributes.menus['webview/context'] ?? [];
    const item = webviewContext.find((entry: { command?: string }) => entry.command === 'intelli-git.changelist.markResolved');

    assert.ok(item, 'mark resolved should be registered in the changelist context menu');
    assert.match(item.when, /webviewSection == 'changelistFile'/);
    assert.match(item.when, /webviewSection == 'changelistFolder'/);
    assert.match(item.when, /webviewSection == 'changelistRoot'/);
    assert.match(item.when, /webviewSection == 'changelistRepository'/);
    assert.match(item.when, /hasConflict == true/);
    assert.match(item.when, /hasResolvedCandidate == true/);
});

test('merge resolver commands are scoped to native webview context sections', () => {
    const packageJson = readPackageJson();
    const webviewContext = packageJson.contributes.menus['webview/context'] ?? [];
    const expected = new Map([
        ['intelli-git.merge.acceptLeft', "(webviewSection == 'mergeEditorLeft' || webviewSection == 'mergeEditorResult') && canReviewLeft == true"],
        ['intelli-git.merge.cancelLeft', "(webviewSection == 'mergeEditorLeft' || webviewSection == 'mergeEditorResult') && canReviewLeft == true"],
        ['intelli-git.merge.acceptRight', "(webviewSection == 'mergeEditorRight' || webviewSection == 'mergeEditorResult') && canReviewRight == true"],
        ['intelli-git.merge.cancelRight', "(webviewSection == 'mergeEditorRight' || webviewSection == 'mergeEditorResult') && canReviewRight == true"],
        ['intelli-git.merge.markReviewed', "webviewSection == 'mergeEditorResult' && canMarkReviewed == true"]
    ]);

    for (const [command, when] of expected) {
        const item = webviewContext.find((entry: { command?: string }) => entry.command === command);
        assert.ok(item, `${command} should be registered in the merge resolver context menu`);
        assert.equal(item.when, when);
    }
});
