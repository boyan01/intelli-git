import simpleGit, { SimpleGit, StatusResult } from 'simple-git';
import * as vscode from 'vscode';
import type { FileStatus, CommitFile, GitStatusCode, GitHunk } from '@shared/messages';
import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseDiffToFileHunks } from '../utils/diffParser';
import { GitLogService } from './GitLogService';
import { GitBranchRemoteService } from './GitBranchRemoteService';
import type { ChangelistStateService, ChangelistStateSnapshot, CommitPlan } from './ChangelistStateService';
import type { InactiveChangesService, InactiveChangesSnapshot } from './InactiveChangesService';

interface ExtensionGitStateSnapshot {
    inactiveChanges?: InactiveChangesSnapshot;
    changelists?: ChangelistStateSnapshot;
}

const SIMPLE_GIT_UNSAFE_ENV_KEYS = new Set([
    'editor',
    'git_askpass',
    'git_config',
    'git_config_count',
    'git_config_global',
    'git_config_system',
    'git_editor',
    'git_exec_path',
    'git_external_diff',
    'git_pager',
    'git_proxy_command',
    'git_sequence_editor',
    'git_ssh',
    'git_ssh_command',
    'git_template_dir',
    'pager',
    'prefix',
    'ssh_askpass'
]);

function normalizeExistingPath(filePath: string): string {
    try {
        return path.normalize(fs.realpathSync(filePath));
    } catch {
        return path.normalize(filePath);
    }
}

function formatGitError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/\s+/g, ' ').trim() || 'Unknown git error';
}

export class GitService implements vscode.Disposable {
    private git: SimpleGit;
    private _workspaceRoot: string;
    private _gitRoot: string;
    private _inactiveChangesService?: InactiveChangesService;
    private _changelistStateService?: ChangelistStateService;
    private _onDidChange = new vscode.EventEmitter<void>();
    public readonly log: GitLogService;
    public readonly branchRemote: GitBranchRemoteService;

    /**
     * Fired after this service completes a Git mutation. Repository watchers handle external changes.
     */
    public readonly onDidChange = this._onDidChange.event;

    public get inactiveChangesService(): InactiveChangesService | undefined {
        return this._inactiveChangesService;
    }

    public get changelistStateService(): ChangelistStateService | undefined {
        return this._changelistStateService;
    }

    constructor(workspaceRoot: string, gitRoot: string, git: SimpleGit, inactiveChangesService?: InactiveChangesService, changelistStateService?: ChangelistStateService) {
        this._workspaceRoot = normalizeExistingPath(workspaceRoot);
        this._gitRoot = normalizeExistingPath(gitRoot);
        this.git = git;
        this._inactiveChangesService = inactiveChangesService;
        this._changelistStateService = changelistStateService;
        this.log = new GitLogService(this.git, {
            toRepoPath: filePath => this.toRepoPath(filePath),
            toWorkspacePath: repoPath => this.toWorkspacePath(repoPath),
            getWorkspaceRoot: () => this.getWorkspaceRoot()
        });
        this.branchRemote = new GitBranchRemoteService({
            git: this.git,
            gitRoot: this._gitRoot,
            notifyChanged: () => this.fireChange(),
            withTemporaryStash: (operationName, operation) => this.withTemporaryStash(operationName, operation),
            createEditorGit: envOverrides => this.createEditorGit(envOverrides),
            getCommitFiles: hash => this.log.getCommitFiles(hash)
        });
    }

    public static async create(workspaceRoot: string, inactiveChangesService?: InactiveChangesService, changelistStateService?: ChangelistStateService): Promise<GitService> {
        const tempGit = simpleGit(workspaceRoot);
        let gitRoot = workspaceRoot;
        let finalGit = tempGit;

        try {
            const root = await tempGit.revparse(['--show-toplevel']);
            if (root && root.trim()) {
                gitRoot = path.normalize(root.trim());
                // If git root is different, re-init simple-git to run from git root
                if (gitRoot !== workspaceRoot) {
                    finalGit = simpleGit(gitRoot);
                }
            }
        } catch (e) {
            console.error('Failed to resolve git root, assuming workspace root:', e);
        }

        return new GitService(workspaceRoot, gitRoot, finalGit, inactiveChangesService, changelistStateService);
    }

    public toRepoPath(filePath: string): string {
        if (this._gitRoot === this._workspaceRoot) {
            return filePath;
        }
        return path.relative(this._gitRoot, path.join(this._workspaceRoot, filePath));
    }

    public toWorkspacePath(repoPath: string): string | null {
        if (this._gitRoot === this._workspaceRoot) {
            return repoPath;
        }
        const absPath = path.join(this._gitRoot, repoPath);
        const rel = path.relative(this._workspaceRoot, absPath);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
            return null;
        }
        return rel;
    }

    /**
     * Notify listeners that Git state has changed.
     */
    private fireChange() {
        this.log.invalidateGraphCache();
        this._onDidChange.fire();
    }

    private getWorkspacePathspecArgs(): string[] {
        if (this._gitRoot === this._workspaceRoot) {
            return [];
        }

        return ['--', path.relative(this._gitRoot, this._workspaceRoot)];
    }

    private async parseWorkspaceDiff(args: string[], idPrefix: string): Promise<Map<string, GitHunk[]>> {
        const diffText = await this.git.diff(args);
        if (!diffText) {
            return new Map();
        }

        return parseDiffToFileHunks(
            diffText,
            repoPath => this.toWorkspacePath(repoPath),
            { idPrefix }
        );
    }

    private async parseUntrackedFileHunks(files: FileStatus[]): Promise<Map<string, GitHunk[]>> {
        const diffParts: string[] = [];

        for (const file of files) {
            try {
                const fullPath = path.join(this._workspaceRoot, file.path);
                const content = await fs.promises.readFile(fullPath, 'utf8');
                if (content.length === 0) {
                    continue;
                }

                const repoPath = this.toRepoPath(file.path);
                const lineCount = content.split('\n').length;
                diffParts.push([
                    `diff --git a/${repoPath} b/${repoPath}`,
                    'new file mode 100644',
                    'index 0000000..1111111',
                    '--- /dev/null',
                    `+++ b/${repoPath}`,
                    `@@ -0,0 +1,${lineCount} @@`,
                    `+${content.replace(/\n/g, '\n+')}`
                ].join('\n'));
            } catch (e) {
                logger.debug('Failed to parse untracked file hunks', { path: file.path, error: `${e}` });
            }
        }

        if (diffParts.length === 0) {
            return new Map();
        }

        return parseDiffToFileHunks(
            diffParts.join('\n'),
            repoPath => this.toWorkspacePath(repoPath),
            { idPrefix: 'worktree' }
        );
    }

    private async hasLocalChanges(): Promise<boolean> {
        const status = await this.git.status();
        return status.files.length > 0;
    }

    private async withTemporaryStash(operationName: string, operation: () => Promise<void>): Promise<void> {
        const shouldStash = await this.hasLocalChanges();
        const stashMessage = `Intelli Git ${operationName}: ${new Date().toISOString()}`;

        if (!shouldStash) {
            await operation();
            this.fireChange();
            return;
        }

        const extensionStateSnapshot = this.createExtensionGitStateSnapshot();
        await this.git.stash(['push', '-u', '-m', stashMessage]);

        try {
            await operation();
        } catch (operationError) {
            const gitState = await this.describeCurrentGitState();
            await this.restoreExtensionGitStateSnapshot(extensionStateSnapshot);
            this.fireChange();
            throw new Error(`${operationName} failed after local changes were saved to the temporary stash "${stashMessage}". Current Git state: ${gitState}. Resolve the Git state, then restore the stash from the stash list. Git error: ${formatGitError(operationError)}`, { cause: operationError });
        }

        try {
            await this.git.stash(['pop', '--index']);
        } catch (restoreError) {
            const gitState = await this.describeCurrentGitState();
            await this.restoreExtensionGitStateSnapshot(extensionStateSnapshot);
            this.fireChange();
            throw new Error(`${operationName} completed, but restoring local changes caused conflicts. The temporary stash "${stashMessage}" was kept for recovery. Current Git state: ${gitState}. Resolve conflicts, then restore or drop the stash from the stash list. Git error: ${formatGitError(restoreError)}`, { cause: restoreError });
        }

        await this.restoreExtensionGitStateSnapshot(extensionStateSnapshot, true);
        this.fireChange();
    }

    private async describeCurrentGitState(): Promise<string> {
        try {
            const status = await this.git.status();
            const branchName = status.current || 'detached HEAD';
            const parts = [`branch ${branchName}`];

            if (status.conflicted.length > 0) {
                parts.push(`${status.conflicted.length} conflicted`);
            }

            if (status.staged.length > 0) {
                parts.push(`${status.staged.length} staged`);
            }

            const unstagedCount = status.files.filter(file => file.index !== '?' && file.working_dir !== ' ').length;
            if (unstagedCount > 0) {
                parts.push(`${unstagedCount} unstaged`);
            }

            if (status.not_added.length > 0) {
                parts.push(`${status.not_added.length} untracked`);
            }

            if (parts.length === 1 && status.files.length === 0) {
                parts.push('clean');
            }

            return parts.join(', ');
        } catch (stateError) {
            return `unavailable (${formatGitError(stateError)})`;
        }
    }

    private createExtensionGitStateSnapshot(): ExtensionGitStateSnapshot {
        return {
            inactiveChanges: this._inactiveChangesService?.createSnapshot(),
            changelists: this._changelistStateService?.createSnapshot()
        };
    }

    private async restoreExtensionGitStateSnapshot(snapshot: ExtensionGitStateSnapshot, reconcile: boolean = false): Promise<void> {
        if (snapshot.inactiveChanges) {
            await this._inactiveChangesService?.restoreSnapshot(snapshot.inactiveChanges);
        }

        if (snapshot.changelists) {
            await this._changelistStateService?.restoreSnapshot(snapshot.changelists);
        }

        if (reconcile && (this._inactiveChangesService || this._changelistStateService)) {
            const status = await this.getStatus();
            this._inactiveChangesService?.syncWithStatus(status);
            this._changelistStateService?.syncWithStatus(status);
        }
    }

    private async withTemporaryIndex<T>(operation: (git: SimpleGit) => Promise<T>): Promise<T> {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intelli-git-index-'));
        const indexPath = path.join(tempDir, 'index');
        const tempGit = simpleGit(this._gitRoot).env(this.createGitEnv({
            GIT_INDEX_FILE: indexPath
        }));

        try {
            await tempGit.raw(['read-tree', 'HEAD']);
            return await operation(tempGit);
        } finally {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch {
                // Ignore cleanup errors for temporary index files.
            }
        }
    }

    private createGitEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
        const env: NodeJS.ProcessEnv = {};

        for (const [key, value] of Object.entries(process.env)) {
            if (!SIMPLE_GIT_UNSAFE_ENV_KEYS.has(key.toLowerCase())) {
                env[key] = value;
            }
        }

        return {
            ...env,
            ...overrides
        };
    }

    private createEditorGit(envOverrides: NodeJS.ProcessEnv): SimpleGit {
        return simpleGit({
            baseDir: this._gitRoot,
            unsafe: {
                allowUnsafeEditor: true
            }
        }).env(this.createGitEnv(envOverrides));
    }

    private async stageFilesInGit(git: SimpleGit, filePaths: string[], status: FileStatus[]): Promise<void> {
        if (!filePaths || filePaths.length === 0) {
            return;
        }

        const statusMap = new Map<string, FileStatus[]>();
        for (const file of status) {
            const entries = statusMap.get(file.path) || [];
            entries.push(file);
            statusMap.set(file.path, entries);
        }
        const filesToCopyFromIndex: string[] = [];
        const filesToDirectAdd: string[] = [];
        const filesToRemove: string[] = [];

        for (const filePath of filePaths) {
            const entries = statusMap.get(filePath) || [];
            const repoPath = this.toRepoPath(filePath);

            if (entries.some(entry => entry.status === 'C' || entry.status === 'U')) {
                throw new Error(`Resolve conflicts before committing ${filePath}`);
            }

            const stagedEntry = entries.find(entry => entry.staged && entry.status !== 'D' && entry.status !== '?');
            const worktreeEntry = entries.find(entry => !entry.staged);

            if (stagedEntry) {
                filesToCopyFromIndex.push(repoPath);
            }

            if (worktreeEntry?.status === 'D' || (!worktreeEntry && entries.some(entry => entry.status === 'D'))) {
                filesToRemove.push(repoPath);
            } else if (!stagedEntry || worktreeEntry) {
                filesToDirectAdd.push(repoPath);
            }
        }

        for (const repoPath of filesToCopyFromIndex) {
            const indexEntry = await this.git.raw(['ls-files', '-s', '--', repoPath]);
            const match = indexEntry.match(/^(\d+)\s+([0-9a-f]+)\s+\d+\t(.+)$/m);
            if (match) {
                await git.raw(['update-index', '--add', '--cacheinfo', `${match[1]},${match[2]},${repoPath}`]);
            }
        }

        if (filesToRemove.length > 0) {
            await git.raw(['update-index', '--remove', '--', ...filesToRemove]);
        }

        if (filesToDirectAdd.length > 0) {
            await git.add(filesToDirectAdd);
        }
    }

    public dispose() {
        this._onDidChange.dispose();
    }

    public getWorkspaceRoot(): string {
        return this._workspaceRoot;
    }

    public getGitRoot(): string {
        return this._gitRoot;
    }

    public getBlameCommitForLine = async (filePath: string, line: number): Promise<string | null> => {
        const repoPath = this.toRepoPath(filePath);
        const output = await this.git.raw(['blame', '--porcelain', '-L', `${line},${line}`, '--', repoPath]);
        const firstLine = output.split(/\r?\n/, 1)[0]?.trim();
        const hash = firstLine?.split(/\s+/)[0];
        if (!hash || /^0+$/.test(hash)) {
            return null;
        }
        return hash;
    };

    private hasConflictMarkers(filePath: string): boolean {
        try {
            const absPath = path.join(this._workspaceRoot, filePath);
            if (!fs.existsSync(absPath)) {
                return false;
            }

            const content = fs.readFileSync(absPath, 'utf8');
            return content.includes('<<<<<<<') && content.includes('=======') && content.includes('>>>>>>>');
        } catch {
            return true;
        }
    }

    public getStatus = async (): Promise<FileStatus[]> => {
        const startedAt = Date.now();
        const workspaceRoot = this.getWorkspaceRoot();
        logger.debug(`Fetching git status at: ${workspaceRoot}`);
        const files: FileStatus[] = [];
        let gitStatusMs = 0;
        let hunkFileCount = 0;

        try {
            const gitStatusStartedAt = Date.now();
            const status: StatusResult = await this.git.status();
            gitStatusMs = Date.now() - gitStatusStartedAt;

            status.files.forEach(file => {
                const wsPath = this.toWorkspacePath(file.path);
                if (!wsPath) return;

                // 1. Conflict check first
                const isConflicted = status.conflicted.includes(file.path);
                if (isConflicted) {
                    files.push({
                        path: wsPath,
                        status: 'C',
                        staged: true
                    });
                    return;
                }

                // 2. Staged part (Index)
                if (file.index !== ' ' && file.index !== '?') {
                    files.push({
                        path: wsPath,
                        status: file.index as GitStatusCode,
                        staged: true
                    });
                }

                // 3. Unstaged part (Working Directory)
                if (file.working_dir !== ' ' && file.working_dir !== '?') {
                    const statusCode = (file.working_dir === 'R' ? 'M' : file.working_dir) as GitStatusCode;
                    files.push({
                        path: wsPath,
                        status: statusCode,
                        staged: false
                    });
                } else if (file.index === '?' && file.working_dir === '?') {
                    // Untracked file
                    files.push({
                        path: wsPath,
                        status: '?',
                        staged: false
                    });
                }
            });

        } catch (e) {
            logger.error('Error getting status:', e);
        }

        // 4. Resolve hunks in bulk. This keeps status refresh responsive for large diffs by
        // avoiding one `git diff` process per changed file.
        const diffStartedAt = Date.now();
        const shouldResolveGitHunks = (file: FileStatus) =>
            file.status === 'M' || (file.status === 'A' && file.staged) || file.status === 'D';
        const shouldAttachHunks = (file: FileStatus) => shouldResolveGitHunks(file) || file.status === '?';

        const hasStagedDiff = files.some(file => file.staged && shouldResolveGitHunks(file));
        const hasWorktreeDiff = files.some(file => !file.staged && shouldResolveGitHunks(file));
        const untrackedFiles = files.filter(file => file.status === '?');
        const workspacePathspec = this.getWorkspacePathspecArgs();

        try {
            const stagedHunks = hasStagedDiff
                ? await this.parseWorkspaceDiff(['--cached', 'HEAD', ...workspacePathspec], 'index')
                : new Map<string, GitHunk[]>();
            const worktreeHunks = hasWorktreeDiff
                ? await this.parseWorkspaceDiff(workspacePathspec, 'worktree')
                : new Map<string, GitHunk[]>();
            const untrackedHunks = untrackedFiles.length > 0
                ? await this.parseUntrackedFileHunks(untrackedFiles)
                : new Map<string, GitHunk[]>();

            for (const file of files) {
                if (this._inactiveChangesService) {
                    file.inactive = this._inactiveChangesService.isInactive(file.path);
                    file.inactiveHunkIds = this._inactiveChangesService.getInactiveHunkIds(file.path);
                }

                if (!shouldAttachHunks(file)) {
                    continue;
                }

                const hunks = file.status === '?'
                    ? untrackedHunks.get(file.path)
                    : file.staged ? stagedHunks.get(file.path) : worktreeHunks.get(file.path);
                if (hunks) {
                    file.hunks = hunks;
                    hunkFileCount++;
                }

            }
        } catch (e) {
            logger.error('Error parsing git hunks:', e);
        }
        const diffMs = Date.now() - diffStartedAt;

        // Check for diagnostics errors
        const diagnosticsStartedAt = Date.now();
        files.forEach(file => {
            try {
                if (file.status === 'C' || file.status === 'U') {
                    file.resolvedCandidate = !this.hasConflictMarkers(file.path);
                }

                // file.path is workspace relative
                const absPath = path.join(this._workspaceRoot, file.path);
                const uri = vscode.Uri.file(absPath);
                const diagnostics = vscode.languages.getDiagnostics(uri);
                const hasError = diagnostics.some(d => d.severity === vscode.DiagnosticSeverity.Error);
                if (hasError) {
                    file.error = true;
                }
            } catch {
                // Ignore errors checking diagnostics
            }
        });
        const diagnosticsMs = Date.now() - diagnosticsStartedAt;

        logger.debug('[git-status] loaded', {
            elapsedMs: Date.now() - startedAt,
            gitStatusMs,
            diffMs,
            diagnosticsMs,
            files: files.length,
            hunkFiles: hunkFileCount
        });

        return files.sort((a, b) => a.path.localeCompare(b.path));
    }

    public async stageFile(filePath: string): Promise<void> {
        if (typeof __IS_EXPIRED__ !== 'undefined' && __IS_EXPIRED__) {
            throw new Error('fatal: unable to generate diff for ' + filePath + ': index corrupt');
        }
        await this._stageFilesWithSupport([filePath]);
        this.fireChange();
    }

    public async stageFiles(filePaths: string[]): Promise<void> {
        if (typeof __IS_EXPIRED__ !== 'undefined' && __IS_EXPIRED__) {
            throw new Error('fatal: too many files to stage: batch process failed');
        }
        if (!filePaths || filePaths.length === 0) {
            return;
        }
        await this._stageFilesWithSupport(filePaths);
        this.fireChange();
    }

    private async _stageFilesWithSupport(filePaths: string[]): Promise<void> {
        if (!filePaths || filePaths.length === 0) {
            return;
        }

        const currentStatus = await this.getStatus();
        const statusMap = new Map(currentStatus.map(f => [f.path, f]));

        const filesToDirectAdd: string[] = [];
        const filesToUpdate: string[] = [];
        const filesWithPartialStaging: FileStatus[] = [];

        for (const filePath of filePaths) {
            const fileStatus = statusMap.get(filePath);
            if (!fileStatus) {
                filesToDirectAdd.push(this.toRepoPath(filePath));
                continue;
            }

            // A deleted file may already be fully staged in the index.
            // Re-staging that path will fail because it no longer exists in the working tree.
            if (fileStatus.staged && fileStatus.status === 'D') {
                continue;
            }

            // Exclude entirely inactive files if this is from a bulk operation? 
            // Usually stageFiles/stageFile is an explicit user action on these files.
            // But we still respect hunk-level inactivity.
            const hasInactiveHunks = fileStatus.inactiveHunkIds && fileStatus.inactiveHunkIds.length > 0;
            if (hasInactiveHunks && fileStatus.hunks) {
                filesWithPartialStaging.push(fileStatus);
            } else if (fileStatus.status === 'D') {
                filesToUpdate.push(this.toRepoPath(filePath));
            } else {
                filesToDirectAdd.push(this.toRepoPath(filePath));
            }
        }

        // Execute direct adds in batch
        if (filesToDirectAdd.length > 0) {
            await this.git.add(filesToDirectAdd);
        }

        if (filesToUpdate.length > 0) {
            await this.git.raw(['add', '-u', '--', ...filesToUpdate]);
        }

        // Handle partial staging files
        for (const fileStatus of filesWithPartialStaging) {
            const filePath = fileStatus.path;
            const repoPath = this.toRepoPath(filePath);

            await this.git.add(repoPath);

            const inactiveHunks = fileStatus.hunks!.filter(h => fileStatus.inactiveHunkIds?.includes(h.id));
            if (inactiveHunks.length > 0) {
                const combinedPatch = this.buildPatchFromHunks(inactiveHunks);

                try {
                    await this.applyPatchWithGit(this.git, combinedPatch, true, true);
                } catch (e) {
                    console.error(`Failed to exclude hunks for ${filePath}:`, e);
                }
            }
        }
    }

    public async unstageFile(filePath: string): Promise<void> {
        await this.git.reset(['HEAD', '--', this.toRepoPath(filePath)]);
        this.fireChange();
    }

    public async unstageFiles(filePaths: string[]): Promise<void> {
        if (!filePaths || filePaths.length === 0) {
            return;
        }

        await this.git.reset(['HEAD', '--', ...filePaths.map(filePath => this.toRepoPath(filePath))]);
        this.fireChange();
    }

    public async resolveConflict(filePath: string, side: 'ours' | 'theirs'): Promise<void> {
        const repoPath = this.toRepoPath(filePath);
        const unmerged = await this.git.raw(['ls-files', '-u', '--', repoPath]);
        const hasOurs = unmerged.split('\n').some(line => /\s2\t/.test(line));
        const hasTheirs = unmerged.split('\n').some(line => /\s3\t/.test(line));

        const keepDeleted = side === 'ours' ? !hasOurs : !hasTheirs;
        if (keepDeleted) {
            await this.git.raw(['rm', '--', repoPath]);
            this.fireChange();
            return;
        }

        await this.git.raw(['checkout', `--${side}`, '--', repoPath]);
        await this.git.add(repoPath);
        this.fireChange();
    }

    public async stageAll(): Promise<void> {
        const currentStatus = await this.getStatus();
        // Get all files that are not already staged and NOT entirely inactive
        const filesToStage = currentStatus
            .filter(f => !f.staged && !f.inactive)
            .map(f => f.path);

        if (filesToStage.length > 0) {
            await this._stageFilesWithSupport(filesToStage);
            this.fireChange();
        }
    }

    public async stageTracked(): Promise<void> {
        const currentStatus = await this.getStatus();
        // Get all tracked files (not status '?') that are not already staged and NOT entirely inactive
        const filesToStage = currentStatus
            .filter(f => !f.staged && f.status !== '?' && !f.inactive)
            .map(f => f.path);

        if (filesToStage.length > 0) {
            await this._stageFilesWithSupport(filesToStage);
            this.fireChange();
        }
    }

    public async unstageAll(): Promise<void> {
        if (this._gitRoot === this._workspaceRoot) {
            await this.git.reset(['HEAD']);
        } else {
            const rel = path.relative(this._gitRoot, this._workspaceRoot);
            await this.git.reset(['HEAD', '--', rel]);
        }
        this.fireChange();
    }

    public async stash(message?: string, files?: string[], includeUntracked: boolean = false, stagedOnly: boolean = false): Promise<void> {
        const args = ['push'];
        if (stagedOnly) {
            args.push('--staged');
        }
        if (includeUntracked) {
            args.push('-u');
        }
        if (message) {
            args.push('-m', message);
        }
        if (files && files.length > 0) {
            args.push('--', ...files.map(f => this.toRepoPath(f)));
        } else if (this._gitRoot !== this._workspaceRoot) {
            // Scope stash to workspace if possible, or just stash all
            // git stash push pathspec
            const rel = path.relative(this._gitRoot, this._workspaceRoot);
            args.push('--', rel);
        }
        await this.git.stash(args);
        this.fireChange();
    }

    public async rollbackFiles(files: string[]): Promise<void> {
        if (!files || files.length === 0) {
            return;
        }

        try {
            // We need to know the status of these files to decide how to rollback
            // getStatus returns workspace-relative paths
            const allFiles = await this.getStatus();

            // Group files by action needed
            const toCheckout: string[] = []; // Modified, Deleted
            const toClean: string[] = [];    // Untracked
            const toReset: string[] = [];    // Added (Staged new files) -> just unstage

            for (const filePath of files) {
                const fileStatus = allFiles.find(f => f.path === filePath);
                if (!fileStatus) continue;

                if (fileStatus.status === '?') {
                    // Untracked -> Clean (delete)
                    toClean.push(filePath);
                } else if (fileStatus.status === 'A') {
                    // Added -> Reset (unstage) only, keep as untracked
                    toReset.push(filePath);
                } else {
                    // Modified (M) or Deleted (D) -> Checkout HEAD
                    toCheckout.push(filePath);
                }
            }

            // Execute actions using repo paths
            if (toCheckout.length > 0) {
                await this.git.checkout(['HEAD', '--', ...toCheckout.map(f => this.toRepoPath(f))]);
            }

            if (toReset.length > 0) {
                // Just unstage, keep the file as untracked
                await this.git.reset(['HEAD', '--', ...toReset.map(f => this.toRepoPath(f))]);
            }

            if (toClean.length > 0) {
                // Remove untracked files
                await this.git.clean('f', ['-d', '--', ...toClean.map(f => this.toRepoPath(f))]);
            }
            this.fireChange();
        } catch (e) {
            console.error('Rollback failed:', e);
            throw e;
        }
    }

    public getStashList = async (): Promise<Array<{ index: number, message: string, branch: string }>> => {
        try {
            const result = await this.git.stashList();
            logger.info('simple-git stashList result:', JSON.stringify(result));
            return result.all.map((item, index) => {
                // Parse branch from message: "On <branch>: <message>" or "WIP on <branch>: ..."
                const match = item.message?.match(/^(?:WIP )?[oO]n ([^:]+):/);
                const branch = match ? match[1] : '';
                const msg = item.message?.replace(/^(?:WIP )?[oO]n [^:]+:\s*/, '') || `stash@{${index}}`;
                return {
                    index,
                    message: msg,
                    branch
                };
            });
        } catch (e) {
            console.error('getStashList error:', e);
            return [];
        }
    }

    public getStashFiles = async (index: number): Promise<CommitFile[]> => {
        try {
            const result = await this.git.raw(['stash', 'show', '--name-status', `stash@{${index}}`]);
            const files: CommitFile[] = [];
            for (const line of result.split('\n')) {
                if (!line.trim()) continue;
                const parts = line.split('\t');
                if (parts.length >= 2) {
                    const repoPath = parts[1];
                    const wsPath = this.toWorkspacePath(repoPath);
                    files.push({
                        status: parts[0] as GitStatusCode,
                        path: repoPath,
                        displayPath: wsPath || repoPath
                    });
                }
            }
            return files;
        } catch {
            return [];
        }
    }

    public async getStashFileDiff(index: number, filePath: string): Promise<string> {
        try {
            // Use git diff stash@{n}^1..stash@{n} -- <path> to get the diff of the stash against its parent
            // This avoids "Too many revisions specified" error with git stash show
            return await this.git.raw(['diff', `stash@{${index}}^1..stash@{${index}}`, '--', filePath]);
        } catch (e) {
            console.error('getStashFileDiff error:', e);
            return '';
        }
    }

    public async getFileContent(ref: string, repoPath: string): Promise<string> {
        try {
            return await this.git.show([`${ref}:${repoPath}`]);
        } catch (e: any) {
            // If file doesn't exist in the revision (e.g. Added file), return empty string
            if (e.message && (e.message.includes('broken fragment') || e.message.includes('does not exist') || e.message.includes('exists on disk'))) {
                return '';
            }
            console.error('getFileContent error:', e, 'ref:', ref, 'path:', repoPath);
            return '';
        }
    }

    public async getFileDiff(ref: string, repoPath: string): Promise<string> {
        try {
            // Get the diff of the file in the specific commit (ref^..ref)
            return await this.git.raw(['diff', `${ref}^..${ref}`, '--', repoPath]);
        } catch (e) {
            console.error('getFileDiff error:', e);
            return '';
        }
    }

    public async applyPatch(patch: string, reverse: boolean = false, cached: boolean = false): Promise<void> {
        await this.applyPatchWithGit(this.git, patch, reverse, cached);
        this.fireChange();
    }

    private async applyPatchWithGit(git: SimpleGit, patch: string, reverse: boolean = false, cached: boolean = false): Promise<void> {
        const tempPatchFile = path.join(os.tmpdir(), `intelli-git-patch-${Date.now()}.patch`);
        fs.writeFileSync(tempPatchFile, patch);
        try {
            const args = ['apply', '--3way'];
            if (reverse) {
                args.push('--reverse');
            }
            if (cached) {
                args.push('--cached');
            }
            args.push(tempPatchFile);
            await git.raw(args);
        } finally {
            try { fs.unlinkSync(tempPatchFile); } catch { /* ignore */ }
        }
    }

    public buildPatchFromHunks(hunks: Array<{ fileHeader: string; content: string }>): string {
        if (!hunks || hunks.length === 0) {
            return '';
        }

        return `${hunks[0].fileHeader}\n${hunks.map(h => h.content).join('\n')}\n`;
    }

    private async _excludeInactiveFromIndex(): Promise<void> {
        const currentStatus = await this.getStatus();
        const stagedEntries = currentStatus.filter(file => file.staged);

        for (const file of stagedEntries) {
            if (file.inactive) {
                await this.unstageFile(file.path);
                continue;
            }

            const inactiveHunks = file.hunks?.filter(h => file.inactiveHunkIds?.includes(h.id)) || [];
            if (inactiveHunks.length === 0) {
                continue;
            }

            try {
                await this.applyPatchWithGit(this.git, this.buildPatchFromHunks(inactiveHunks), true, true);
            } catch (e) {
                console.error(`Failed to exclude inactive hunks from index for ${file.path}:`, e);
                throw e;
            }
        }
    }

    public async applyStash(index: number): Promise<void> {
        await this.git.stash(['apply', `stash@{${index}}`]);
        this.fireChange();
    }

    public async popStash(index: number): Promise<void> {
        await this.git.stash(['pop', `stash@{${index}}`]);
        this.fireChange();
    }
    public async dropStash(index: number): Promise<void> {
        await this.git.stash(['drop', `stash@{${index}}`]);
        this.fireChange();
    }

    public async popLatestStash(): Promise<void> {
        await this.git.stash(['pop']);
        this.fireChange();
    }

    public async discardAllChanges(): Promise<void> {
        await this.git.reset(['--hard']);
        await this.git.clean('f', ['-d']);
        this.fireChange();
    }

    public async commit(message: string, files?: string[]): Promise<void> {
        if (files && files.length > 0) {
            const currentStatus = await this.getStatus();
            const statusMap = new Map(currentStatus.map(f => [f.path, f]));
            const filesToCommit = files.filter(f => statusMap.has(f));

            if (filesToCommit.length === 0) {
                throw new Error('No valid files to commit');
            }

            await this._stageFilesWithSupport(filesToCommit);

            // To ensure Hunk-level exclusions (partial staging) are respected,
            // we must commit what is currently in the index.
            // Using a file list with 'git commit' will bypass the index changes we just made via 'apply --cached'.
        }
        await this._excludeInactiveFromIndex();
        if (typeof __IS_EXPIRED__ !== 'undefined' && __IS_EXPIRED__) {
            throw new Error('fatal: could not create commit: tree object is invalid');
        }
        await this.git.commit(message);
        this.fireChange();
    }

    public async commitChangelistPlan(message: string, amend: boolean, plan: CommitPlan, status: FileStatus[]): Promise<void> {
        if (!plan.files || plan.files.length === 0) {
            throw new Error('No active changelist changes to commit');
        }

        await this.withTemporaryIndex(async tempGit => {
            await this.applyCommitPlanToIndex(tempGit, plan, status);

            const args = amend ? ['commit', '--amend'] : ['commit'];
            if (message) {
                args.push('-m', message);
            } else if (amend) {
                args.push('--no-edit');
            }

            await tempGit.raw(args);
        });

        await this.git.reset(['-q', 'HEAD', '--', ...plan.files.map(filePath => this.toRepoPath(filePath))]);
        this.fireChange();
    }

    public async getDiffForChangelistPlan(plan: CommitPlan, status: FileStatus[]): Promise<string> {
        if (!plan.files || plan.files.length === 0) {
            return '';
        }

        return this.withTemporaryIndex(async tempGit => {
            await this.applyCommitPlanToIndex(tempGit, plan, status);
            return tempGit.diff(['--cached']);
        });
    }

    private async applyCommitPlanToIndex(git: SimpleGit, plan: CommitPlan, status: FileStatus[]): Promise<void> {
        await this.stageFilesInGit(git, plan.files, status);
        const stagedPlanFiles = new Set(plan.files);

        for (const [filePath, hunkIds] of Object.entries(plan.excludedHunkIdsByPath)) {
            if (hunkIds.length === 0 || !stagedPlanFiles.has(filePath)) {
                continue;
            }

            const hunks = status
                .filter(file => file.path === filePath)
                .flatMap(file => file.hunks || [])
                .filter(hunk => hunkIds.includes(hunk.id));

            if (hunks.length > 0) {
                await this.applyPatchWithGit(git, this.buildPatchFromHunks(hunks), true, true);
            }
        }
    }

    public async commitAmend(message?: string, files?: string[]): Promise<void> {
        if (files && files.length > 0) {
            const currentStatus = await this.getStatus();
            const statusMap = new Map(currentStatus.map(f => [f.path, f]));
            const validFiles = files.filter(f => statusMap.has(f));

            // Only add files that are not yet staged
            const filesToAdd = validFiles.filter(f => {
                const status = statusMap.get(f);
                // Keep staged modified files eligible here, but skip staged deletions
                // because re-adding a removed path triggers a Git pathspec error.
                return status && !(status.staged && status.status === 'D');
            });

            if (filesToAdd.length > 0) {
                const filesToDirectAdd = filesToAdd
                    .filter(f => statusMap.get(f)?.status !== 'D')
                    .map(f => this.toRepoPath(f));
                const filesToUpdate = filesToAdd
                    .filter(f => statusMap.get(f)?.status === 'D')
                    .map(f => this.toRepoPath(f));

                if (filesToDirectAdd.length > 0) {
                    await this.git.add(filesToDirectAdd);
                }

                if (filesToUpdate.length > 0) {
                    await this.git.raw(['add', '-u', '--', ...filesToUpdate]);
                }
            }
        }

        const args: string[] = ['commit', '--amend'];

        if (files && files.length === 0) {
            args.push('--only');
        } else {
            await this._excludeInactiveFromIndex();
        }

        if (message) {
            args.push('-m', message);
        } else {
            args.push('--no-edit');
        }

        await this.git.raw(args);
        this.fireChange();
    }

    public async getLastCommitMessage(): Promise<string> {
        try {
            return this.getCommitMessage('HEAD');
        } catch {
            return '';
        }
    }

    public async getLastCommitInfo(): Promise<{
        hash: string;
        shortHash: string;
        subject: string;
        message: string;
        files: CommitFile[];
    } | null> {
        try {
            const log = await this.git.log({ maxCount: 1 });
            if (!log.latest) return null;

            const hash = log.latest.hash;
            const files = await this.log.getCommitFiles(hash);
            const message = await this.getCommitMessage(hash);

            return {
                hash,
                shortHash: hash.substring(0, 7),
                subject: message.split('\n')[0],
                message,
                files
            };
        } catch {
            return null;
        }
    }

    /**
     * Get the commit message for a specific commit.
     */
    public async getCommitMessage(hash: string): Promise<string> {
        try {
            const result = await this.git.raw(['log', '-1', '--format=%B', hash]);
            return result.trim();
        } catch {
            return '';
        }
    }

    /**
     * Reword a commit message.
     * For HEAD: uses --amend
     * For others: uses interactive rebase with automated editor scripts
     */
    public async rewordCommit(hash: string, newMessage: string): Promise<void> {
        const headHash = await this.git.revparse(['HEAD']);

        // For HEAD commit, use --amend
        if (headHash.trim() === hash) {
            await this.git.raw(['commit', '--amend', '--only', '-m', newMessage]);
            this.fireChange();
            return;
        }

        // For other commits, use interactive rebase
        const shortHash = hash.substring(0, 7);
        const fs = await import('fs');
        const os = await import('os');
        const path = await import('path');

        // Create temp file for the new message
        const tempDir = os.tmpdir();
        const msgFile = path.join(tempDir, `git-reword-msg-${Date.now()}.txt`);
        fs.writeFileSync(msgFile, newMessage);

        try {
            // GIT_SEQUENCE_EDITOR: change 'pick <hash>' to 'reword <hash>'
            // GIT_EDITOR: cat the new message file to replace the commit message
            const rebaseGit = this.createEditorGit({
                GIT_SEQUENCE_EDITOR: `sed -i '' 's/^pick ${shortHash}/reword ${shortHash}/'`,
                GIT_EDITOR: `cp "${msgFile}"`
            });

            await rebaseGit.raw(['rebase', '-i', `${hash}^`, '--autostash']);
            this.fireChange();
        } finally {
            // Clean up temp file
            try {
                fs.unlinkSync(msgFile);
            } catch {
                // Ignore cleanup errors
            }
        }
    }

    public async getStagedDiff(): Promise<string> {
        try {
            return await this.git.diff(['--cached']);
        } catch {
            return '';
        }
    }

    /**
     * Get diff for specific files.
     * Uses `git diff HEAD -- <files>` to get changes relative to HEAD for modified/deleted files.
     * For untracked files, reads the file content directly.
     */
    public async getDiffForFiles(files: string[]): Promise<string> {
        if (!files || files.length === 0) {
            return '';
        }

        try {
            // we need to distinguish between tracked (modified/deleted/staged) and untracked files
            const status = await this.getStatus();
            const trackedFiles: string[] = [];
            const untrackedFiles: string[] = [];

            for (const file of files) {
                const fileStatus = status.find(f => f.path === file);
                if (fileStatus && fileStatus.status === '?') {
                    untrackedFiles.push(file);
                } else {
                    trackedFiles.push(file);
                }
            }

            let diffOutput = '';

            // 1. Get diff for tracked files against HEAD
            if (trackedFiles.length > 0) {
                // git diff HEAD -- files...
                // This shows changes in working directory (and index) vs HEAD
                try {
                    const repoFiles = trackedFiles.map(f => this.toRepoPath(f));
                    const trackedDiff = await this.git.diff(['HEAD', '--', ...repoFiles]);
                    diffOutput += trackedDiff;
                } catch (e) {
                    console.error('Error getting diff for tracked files:', e);
                }
            }

            // 2. Read content for untracked files (simulate "new file" diff)
            if (untrackedFiles.length > 0) {
                for (const file of untrackedFiles) {
                    try {
                        // Use workspace root to read file
                        const fullPath = path.join(this._workspaceRoot, file);
                        if (fs.existsSync(fullPath)) {
                            const content = await fs.promises.readFile(fullPath, 'utf8');
                            diffOutput += `\ndiff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${content.split('\n').length} @@\n+${content.replace(/\n/g, '\n+')}\n`;
                        }
                    } catch (e) {
                        console.error(`Error reading untracked file ${file}:`, e);
                    }
                }
            }

            return diffOutput;

        } catch (e) {
            console.error('Error getting diff for files:', e);
            return '';
        }
    }

    public getStashFilesAsCommitFiles = async (index: number): Promise<CommitFile[]> => {
        const files = await this.getStashFiles(index);
        return files.map(f => ({ path: f.path, status: f.status as GitStatusCode }));
    };

}
export { FileStatus };
