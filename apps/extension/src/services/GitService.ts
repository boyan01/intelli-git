import simpleGit, { SimpleGit, StatusResult } from 'simple-git';
import * as vscode from 'vscode';
import type { BranchInfo, LogCommit, LogOptions, CommitDetails, RefInfo, FileStatus, CommitFile, PushInitState, PushCommitsData, BranchListData, GitStatusCode, GitHunk } from '@shared/messages';
import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseDiffToFileHunks } from '../utils/diffParser';
import type { ChangelistStateService, ChangelistStateSnapshot, CommitPlan } from './ChangelistStateService';
import type { InactiveChangesService, InactiveChangesSnapshot } from './InactiveChangesService';

interface ExtensionGitStateSnapshot {
    inactiveChanges?: InactiveChangesSnapshot;
    changelists?: ChangelistStateSnapshot;
}


export class GitService implements vscode.Disposable {
    private git: SimpleGit;
    private _workspaceRoot: string;
    private _gitRoot: string;
    private _inactiveChangesService?: InactiveChangesService;
    private _changelistStateService?: ChangelistStateService;
    private _onDidChange = new vscode.EventEmitter<void>();

    /**
     * Fired when Git state changes (commit, reset, branch switch, etc.)
     */
    public readonly onDidChange = this._onDidChange.event;

    constructor(workspaceRoot: string, gitRoot: string, git: SimpleGit, inactiveChangesService?: InactiveChangesService, changelistStateService?: ChangelistStateService) {
        this._workspaceRoot = workspaceRoot;
        this._gitRoot = gitRoot;
        this.git = git;
        this._inactiveChangesService = inactiveChangesService;
        this._changelistStateService = changelistStateService;
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
            await this.restoreExtensionGitStateSnapshot(extensionStateSnapshot);
            this.fireChange();
            throw new Error(`${operationName} failed after local changes were saved to the stash. Resolve the git state, then restore "${stashMessage}" from the stash list.`, { cause: operationError });
        }

        try {
            await this.git.stash(['pop', '--index']);
        } catch (restoreError) {
            await this.restoreExtensionGitStateSnapshot(extensionStateSnapshot);
            this.fireChange();
            throw new Error(`${operationName} completed, but restoring local changes caused conflicts. The temporary stash was kept for recovery.`, { cause: restoreError });
        }

        await this.restoreExtensionGitStateSnapshot(extensionStateSnapshot, true);
        this.fireChange();
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
        const tempGit = simpleGit(this._gitRoot).env({
            ...process.env,
            GIT_INDEX_FILE: indexPath
        });

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

    private async stageFilesInGit(git: SimpleGit, filePaths: string[], status: FileStatus[]): Promise<void> {
        if (!filePaths || filePaths.length === 0) {
            return;
        }

        const statusMap = new Map(status.map(file => [file.path, file]));
        const filesToDirectAdd: string[] = [];
        const filesToUpdate: string[] = [];

        for (const filePath of filePaths) {
            const fileStatus = statusMap.get(filePath);
            const repoPath = this.toRepoPath(filePath);

            if (fileStatus?.status === 'D') {
                filesToUpdate.push(repoPath);
            } else {
                filesToDirectAdd.push(repoPath);
            }
        }

        if (filesToDirectAdd.length > 0) {
            await git.add(filesToDirectAdd);
        }

        if (filesToUpdate.length > 0) {
            await git.raw(['add', '-u', '--', ...filesToUpdate]);
        }
    }

    public dispose() {
        this._onDidChange.dispose();
    }

    public getWorkspaceRoot(): string {
        return this._workspaceRoot;
    }

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
        const shouldResolveHunks = (file: FileStatus) =>
            file.status === 'M' || (file.status === 'A' && file.staged) || file.status === 'D';

        const hasStagedDiff = files.some(file => file.staged && shouldResolveHunks(file));
        const hasWorktreeDiff = files.some(file => !file.staged && shouldResolveHunks(file));
        const workspacePathspec = this.getWorkspacePathspecArgs();

        try {
            const stagedHunks = hasStagedDiff
                ? await this.parseWorkspaceDiff(['--cached', 'HEAD', ...workspacePathspec], 'index')
                : new Map<string, GitHunk[]>();
            const worktreeHunks = hasWorktreeDiff
                ? await this.parseWorkspaceDiff(workspacePathspec, 'worktree')
                : new Map<string, GitHunk[]>();

            for (const file of files) {
                if (!shouldResolveHunks(file)) {
                    continue;
                }

                const hunks = file.staged ? stagedHunks.get(file.path) : worktreeHunks.get(file.path);
                if (hunks) {
                    file.hunks = hunks;
                    hunkFileCount++;
                }

                if (this._inactiveChangesService) {
                    file.inactiveHunkIds = this._inactiveChangesService.getInactiveHunkIds(file.path);
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

    public async getBranches(): Promise<BranchInfo> {
        try {
            const branchSummary = await this.git.branchLocal();
            return {
                current: branchSummary.current,
                all: branchSummary.all
            };
        } catch (e) {
            console.error('Error getting branches:', e);
            return { current: '', all: [] };
        }
    }

    public async switchBranch(branchName: string, force: boolean = false): Promise<void> {
        if (force) {
            await this.git.checkout(['-f', branchName]);
            this.fireChange();
            return;
        }

        await this.withTemporaryStash(`switch branch ${branchName}`, async () => {
            await this.git.checkout(branchName);
        });
    }

    public async stageFile(filePath: string): Promise<void> {
        if (typeof __IS_EXPIRED__ !== 'undefined' && __IS_EXPIRED__) {
            throw new Error('fatal: unable to generate diff for ' + filePath + ': index corrupt');
        }
        await this._stageFilesWithSupport([filePath]);
    }

    public async stageFiles(filePaths: string[]): Promise<void> {
        if (typeof __IS_EXPIRED__ !== 'undefined' && __IS_EXPIRED__) {
            throw new Error('fatal: too many files to stage: batch process failed');
        }
        await this._stageFilesWithSupport(filePaths);
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
                    await this.applyPatch(combinedPatch, true, true);
                } catch (e) {
                    console.error(`Failed to exclude hunks for ${filePath}:`, e);
                }
            }
        }
    }

    public async unstageFile(filePath: string): Promise<void> {
        await this.git.reset(['HEAD', '--', this.toRepoPath(filePath)]);
    }

    public async unstageFiles(filePaths: string[]): Promise<void> {
        if (!filePaths || filePaths.length === 0) {
            return;
        }

        await this.git.reset(['HEAD', '--', ...filePaths.map(filePath => this.toRepoPath(filePath))]);
    }

    public async resolveConflict(filePath: string, side: 'ours' | 'theirs'): Promise<void> {
        const repoPath = this.toRepoPath(filePath);
        const unmerged = await this.git.raw(['ls-files', '-u', '--', repoPath]);
        const hasOurs = unmerged.split('\n').some(line => /\s2\t/.test(line));
        const hasTheirs = unmerged.split('\n').some(line => /\s3\t/.test(line));

        const keepDeleted = side === 'ours' ? !hasOurs : !hasTheirs;
        if (keepDeleted) {
            await this.git.raw(['rm', '--', repoPath]);
            return;
        }

        await this.git.raw(['checkout', `--${side}`, '--', repoPath]);
        await this.git.add(repoPath);
    }

    public async stageAll(): Promise<void> {
        const currentStatus = await this.getStatus();
        // Get all files that are not already staged and NOT entirely inactive
        const filesToStage = currentStatus
            .filter(f => !f.staged && !f.inactive)
            .map(f => f.path);

        if (filesToStage.length > 0) {
            await this._stageFilesWithSupport(filesToStage);
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
        }
    }

    public async unstageAll(): Promise<void> {
        if (this._gitRoot === this._workspaceRoot) {
            await this.git.reset(['HEAD']);
        } else {
            const rel = path.relative(this._gitRoot, this._workspaceRoot);
            await this.git.reset(['HEAD', '--', rel]);
        }
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
                await this.applyPatch(this.buildPatchFromHunks(inactiveHunks), true, true);
            } catch (e) {
                console.error(`Failed to exclude inactive hunks from index for ${file.path}:`, e);
                throw e;
            }
        }
    }

    public async applyStash(index: number): Promise<void> {
        await this.git.stash(['apply', `stash@{${index}}`]);
    }

    public async popStash(index: number): Promise<void> {
        await this.git.stash(['pop', `stash@{${index}}`]);
    }
    public async dropStash(index: number): Promise<void> {
        await this.git.stash(['drop', `stash@{${index}}`]);
    }

    public async popLatestStash(): Promise<void> {
        await this.git.stash(['pop']);
    }

    public async discardAllChanges(): Promise<void> {
        await this.git.reset(['--hard']);
        await this.git.clean('f', ['-d']);
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

        for (const [filePath, hunkIds] of Object.entries(plan.excludedHunkIdsByPath)) {
            if (hunkIds.length === 0) {
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

        await this._excludeInactiveFromIndex();

        const args: string[] = ['commit', '--amend'];
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
            const log = await this.git.log({ maxCount: 1 });
            return log.latest?.message || '';
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
            const files = await this.getCommitFiles(hash);
            const message = log.latest.message || '';

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
            await this.git.raw(['commit', '--amend', '-m', newMessage]);
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
            const env = {
                ...process.env,
                GIT_SEQUENCE_EDITOR: `sed -i '' 's/^pick ${shortHash}/reword ${shortHash}/'`,
                GIT_EDITOR: `cp "${msgFile}"`
            };

            await this.git.env(env).raw(['rebase', '-i', `${hash}^`, '--autostash']);
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

    public async push(remote: string, branch: string, options?: { noVerify?: boolean }): Promise<void> {
        const args: string[] = [];
        if (options?.noVerify) {
            args.push('--no-verify');
        }
        await this.git.push(remote, branch, args);
        this.fireChange();
    }

    /**
     * Set upstream tracking branch for the current branch.
     */
    public async setUpstreamBranch(remote: string, remoteBranch: string): Promise<void> {
        await this.git.raw(['branch', '--set-upstream-to', `${remote}/${remoteBranch}`]);
    }

    /**
     * Get the upstream branch for a local branch.
     */
    public async getUpstreamBranch(localBranch?: string): Promise<string | null> {
        try {
            const branchArg = localBranch ? localBranch : 'HEAD';
            const result = await this.git.raw(['rev-parse', '--abbrev-ref', `${branchArg}@{upstream}`]);
            return result.trim() || null;
        } catch {
            return null;
        }
    }

    public async pull(): Promise<void> {
        await this.withTemporaryStash('pull --rebase', async () => {
            await this.git.raw(['pull', '--rebase']);
        });
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

    public async getRemotes(): Promise<string[]> {
        try {
            const remotes = await this.git.getRemotes();
            return remotes.map(r => r.name);
        } catch (e) {
            console.error('Error getting remotes:', e);
            return [];
        }
    }

    public async getRemoteBranches(): Promise<string[]> {
        try {
            const branches = await this.git.branch(['-r']);
            return branches.all;
        } catch (e) {
            console.error('Error getting remote branches:', e);
            return [];
        }
    }

    public async fetch(): Promise<void> {
        await this.git.fetch(['--all', '--prune']);
    }

    /**
     * Update a non-current local branch to match its remote tracking branch.
     * Uses `git fetch origin branch:branch` syntax.
     * @param branch Local branch name to update
     * @param force If true, force overwrite local branch even if it has diverged
     * @returns 'success' | 'diverged' indicating the result
     */
    public async updateBranch(branch: string, force: boolean = false): Promise<'success' | 'diverged'> {
        const remotes = await this.getRemotes();
        const remote = remotes.length > 0 ? remotes[0] : 'origin';

        try {
            if (force) {
                await this.git.fetch([remote, `+${branch}:${branch}`]);
            } else {
                await this.git.fetch([remote, `${branch}:${branch}`]);
            }
            return 'success';
        } catch (e: any) {
            if (e.message && e.message.includes('non-fast-forward')) {
                return 'diverged';
            }
            throw e;
        }
    }

    public async getIncomingCommitsCount(): Promise<number> {
        try {
            const count = await this.git.raw(['rev-list', '--count', 'HEAD..@{u}']);
            return parseInt(count.trim(), 10);
        } catch {
            return 0;
        }
    }

    public async getBranchStatus(): Promise<{ ahead: number; behind: number }> {
        try {
            // git rev-list --left-right --count HEAD...@{u}
            // Returns: "<ahead> <behind>" e.g. "1 0" if ahead by 1
            const result = await this.git.raw(['rev-list', '--left-right', '--count', `HEAD...@{u}`]);
            const [ahead, behind] = result.trim().split(/\s+/).map(n => parseInt(n, 10));

            return { ahead: ahead || 0, behind: behind || 0 };
        } catch {
            // If upstream is not configured, we can still calculate ahead by checking commits not in any remote
            try {
                // Get count of commits in HEAD but not in any remote
                const aheadCount = await this.git.raw(['rev-list', '--count', 'HEAD', '--not', '--remotes']);
                return { ahead: parseInt(aheadCount.trim(), 10) || 0, behind: 0 };
            } catch {
                return { ahead: 0, behind: 0 };
            }
        }
    }

    /**
     * Get list of unpushed commit hashes (commits in local but not in upstream).
     * For branches without upstream, returns commits not reachable from any remote.
     */
    public async getUnpushedCommits(): Promise<Set<string>> {
        try {
            // Get commits that are in HEAD but not in upstream
            const result = await this.git.raw(['rev-list', '@{u}..HEAD']);
            const hashes = result.trim().split('\n').filter(h => h.length > 0);
            return new Set(hashes);
        } catch {
            // No upstream configured (e.g., new branch), get commits not in any remote
            try {
                const result = await this.git.raw(['log', 'HEAD', '--not', '--remotes', '--format=%H']);
                const hashes = result.trim().split('\n').filter(h => h.length > 0);
                return new Set(hashes);
            } catch {
                return new Set();
            }
        }
    }

    /**
     * Get ahead/behind info for ALL local branches in a single git call.
     */
    public async getAllBranchesAheadBehind(): Promise<Map<string, { ahead: number; behind: number; upstream?: string }>> {
        const result = new Map<string, { ahead: number; behind: number; upstream?: string }>();
        try {
            const output = await this.git.raw([
                'for-each-ref',
                '--format=%(refname:short)%00%(upstream:short)%00%(upstream:track)',
                'refs/heads'
            ]);

            for (const line of output.trim().split('\n')) {
                if (!line) continue;
                const [branch, upstream, track] = line.split('\0');

                let ahead = 0, behind = 0;
                if (track) {
                    const aheadMatch = track.match(/ahead (\d+)/);
                    const behindMatch = track.match(/behind (\d+)/);
                    if (aheadMatch) ahead = parseInt(aheadMatch[1], 10);
                    if (behindMatch) behind = parseInt(behindMatch[1], 10);
                }

                result.set(branch, {
                    ahead,
                    behind,
                    upstream: upstream || undefined
                });
            }
        } catch {
            // ignore
        }
        return result;
    }

    public async createBranch(branchName: string): Promise<void> {
        await this.git.checkoutLocalBranch(branchName);
    }

    public async checkoutRemoteBranch(remoteBranch: string, force: boolean = false): Promise<void> {
        const checkout = async () => {
            const parts = remoteBranch.split('/');
            const localBranchName = parts.slice(1).join('/');

            const localBranches = await this.getBranches();
            if (localBranches.all.includes(localBranchName)) {
                if (force) {
                    await this.git.checkout(['-f', localBranchName]);
                } else {
                    await this.git.checkout(localBranchName);
                }
            } else {
                // New branch from remote, force doesn't apply to creation usually unless overwrite,
                // but here we are checking out. If force is true, we might want to start clean.
                // `git checkout --track origin/b` may fail when local changes conflict.
                const args = ['-b', localBranchName, '--track', remoteBranch];
                if (force) {
                    args.unshift('-f');
                }
                await this.git.checkout(args);
            }
        };

        if (force) {
            await checkout();
            this.fireChange();
            return;
        }

        await this.withTemporaryStash(`checkout remote branch ${remoteBranch}`, checkout);
    }


    public async getCommitsToPush(
        localBranch: string,
        remote: string,
        remoteBranch: string,
        options: { maxCount?: number; skip?: number } = {}
    ): Promise<CommitDetails[]> {
        try {
            const hasRemoteBranch = await this._remoteBranchExists(remote, remoteBranch);

            if (hasRemoteBranch) {
                const args: string[] = ['log'];

                if (options.maxCount) {
                    args.push(`--max-count=${options.maxCount}`);
                }

                if (options.skip) {
                    args.push(`--skip=${options.skip}`);
                }

                args.push('--format=%H%x00%h%x00%s%x00%an%x00%aI%x00%ae%x00%P');
                args.push(`${remote}/${remoteBranch}..${localBranch}`);

                const result = await this.git.raw(args);

                if (!result.trim()) {
                    return [];
                }

                return result.trim().split('\n').map(line => {
                    const [hash, shortHash, subject, authorName, date, authorEmail, parentsStr] = line.split('\x00');
                    return {
                        hash,
                        shortHash,
                        subject,
                        authorName,
                        date,
                        authorEmail,
                        body: '',
                        files: [],
                        stats: { additions: 0, deletions: 0 },
                        parentHashes: parentsStr ? parentsStr.split(' ') : [],
                        containingBranches: [],
                        refs: [],
                        filteredAncestors: []
                    };
                });
            } else {
                // New remote branch: get commits not reachable from any remote
                return this._getCommitsNotInRemote(localBranch, options.maxCount ?? 20, options.skip);
            }
        } catch (e) {
            console.error('Error getting commits to push:', e);
            return [];
        }
    }

    public async getCommitsToPushCount(
        localBranch: string,
        remote: string,
        remoteBranch: string
    ): Promise<number> {
        try {
            const hasRemoteBranch = await this._remoteBranchExists(remote, remoteBranch);

            if (hasRemoteBranch) {
                const count = await this.git.raw(['rev-list', '--count', `${remote}/${remoteBranch}..${localBranch}`]);
                return parseInt(count.trim(), 10);
            } else {
                // For new branch, count all commits not in any remote
                const count = await this.git.raw(['rev-list', '--count', localBranch, '--not', '--remotes']);
                return parseInt(count.trim(), 10);
            }
        } catch {
            return 0;
        }
    }

    private async _getCommitsNotInRemote(branch: string, maxCount: number, skip?: number): Promise<CommitDetails[]> {
        try {
            const args = [
                'log',
                branch,
                '--not',
                '--remotes',
                `--max-count=${maxCount}`,
                '--format=%H%x00%h%x00%s%x00%an%x00%aI%x00%ae%x00%P'
            ];

            if (skip) {
                args.push(`--skip=${skip}`);
            }

            const result = await this.git.raw(args);

            if (!result.trim()) {
                return [];
            }

            return result.trim().split('\n').map(line => {
                const [hash, shortHash, subject, authorName, date, authorEmail, parentsStr] = line.split('\x00');
                return {
                    hash,
                    shortHash,
                    subject,
                    authorName,
                    date,
                    authorEmail,
                    body: '',
                    files: [],
                    stats: { additions: 0, deletions: 0 },
                    parentHashes: parentsStr ? parentsStr.split(' ') : [],
                    containingBranches: [],
                    refs: [],
                    filteredAncestors: []
                };
            });
        } catch {
            return [];
        }
    }

    private async _remoteBranchExists(remote: string, branch: string): Promise<boolean> {
        try {
            await this.git.revparse([`${remote}/${branch}`]);
            return true;
        } catch {
            return false;
        }
    }

    private async _getRecentCommits(count: number): Promise<CommitDetails[]> {
        try {
            const log = await this.git.log({ maxCount: count });
            return log.all.map(commit => ({
                hash: commit.hash,
                shortHash: commit.hash.substring(0, 8),
                subject: commit.message,
                authorName: commit.author_name,
                date: commit.date,
                authorEmail: commit.author_email,
                body: '',
                files: [],
                stats: { additions: 0, deletions: 0 },
                parentHashes: [],
                containingBranches: [],
                refs: [],
                filteredAncestors: []
            }));
        } catch {
            return [];
        }
    }

    public async getRebaseStatus(): Promise<'none' | 'interactive' | 'merging'> {
        try {
            const gitDir = (await this.git.revparse(['--git-dir'])).trim();
            const absoluteGitDir = path.isAbsolute(gitDir)
                ? gitDir
                : path.join(this._workspaceRoot, gitDir);

            const rebaseMergeDir = path.join(absoluteGitDir, 'rebase-merge');
            const rebaseApplyDir = path.join(absoluteGitDir, 'rebase-apply');
            const mergeHeadFile = path.join(absoluteGitDir, 'MERGE_HEAD');

            if (fs.existsSync(rebaseMergeDir) || fs.existsSync(rebaseApplyDir)) {
                return 'interactive';
            }

            if (fs.existsSync(mergeHeadFile)) {
                return 'merging';
            }

            return 'none';
        } catch {
            return 'none';
        }
    }

    public async abortRebase(): Promise<void> {
        const status = await this.getRebaseStatus();
        if (status === 'merging') {
            await this.git.raw(['merge', '--abort']);
            return;
        }

        await this.git.rebase(['--abort']);
    }

    public async continueRebase(message?: string): Promise<void> {
        const status = await this.getRebaseStatus();

        // If a message is provided, try to update the relevant message file
        if (message) {
            try {
                const gitDir = await this.git.revparse(['--git-dir']);
                const rebaseMergeMsg = path.join(gitDir.trim(), 'rebase-merge', 'message');
                const mergeMsg = path.join(gitDir.trim(), 'MERGE_MSG');

                if (fs.existsSync(rebaseMergeMsg)) {
                    fs.writeFileSync(rebaseMergeMsg, message, 'utf8');
                } else if (fs.existsSync(mergeMsg)) {
                    fs.writeFileSync(mergeMsg, message, 'utf8');
                }
            } catch (e) {
                console.error('Failed to update rebase message:', e);
            }
        }

        const gitWithEditorBypass = this.git.env({ ...process.env, GIT_EDITOR: 'true' });
        if (status === 'merging') {
            await gitWithEditorBypass.raw(['merge', '--continue']);
            return;
        }

        await gitWithEditorBypass.rebase(['--continue']);
    }

    public async getRebaseCommitMessage(): Promise<string> {
        try {
            let gitDir = (await this.git.revparse(['--git-dir'])).trim();

            // Ensure gitDir is absolute
            if (!path.isAbsolute(gitDir) && this._workspaceRoot) {
                gitDir = path.join(this._workspaceRoot, gitDir);
            }

            logger.info('rebaseMergeMsg gitDir', gitDir);

            const rebaseMergeMsg = path.join(gitDir, 'rebase-merge', 'message');
            const rebaseApplyMsg = path.join(gitDir, 'rebase-apply', 'msg');
            const mergeMsg = path.join(gitDir, 'MERGE_MSG');

            if (fs.existsSync(rebaseMergeMsg)) {
                return fs.readFileSync(rebaseMergeMsg, 'utf8').trim();
            } else if (fs.existsSync(rebaseApplyMsg)) {
                return fs.readFileSync(rebaseApplyMsg, 'utf8').trim();
            } else if (fs.existsSync(mergeMsg)) {
                return fs.readFileSync(mergeMsg, 'utf8').trim();
            }
        } catch (e) {
            console.error('Failed to read rebase message:', e);
        }
        return '';
    }

    public getCommitFiles = async (hash: string): Promise<CommitFile[]> => {
        try {
            const result = await this.git.show([hash, '--name-status', '--pretty=format:']);
            const lines = result.split('\n').filter(l => l.trim());
            return lines.map(line => {
                const [status, ...pathParts] = line.split('\t');
                const repoPath = pathParts.join('\t');
                const wsPath = this.toWorkspacePath(repoPath);
                return {
                    path: repoPath,
                    displayPath: wsPath || repoPath,
                    status: status as GitStatusCode
                };
            });
        } catch (e) {
            console.error('Error getting commit files:', e);
            return [];
        }
    };

    public getMultiCommitFiles = async (hashes: string[]): Promise<CommitFile[]> => {
        const fileMap = new Map<string, CommitFile>();
        for (const hash of hashes) {
            try {
                const files = await this.getCommitFiles(hash);
                for (const file of files) {
                    fileMap.set(file.path, file);
                }
            } catch {
                // ignore
            }
        }
        return Array.from(fileMap.values());
    };

    public async forcePush(remote: string, branch: string, options?: { noVerify?: boolean }): Promise<void> {
        const args: string[] = ['--force'];
        if (options?.noVerify) {
            args.push('--no-verify');
        }
        await this.git.push(remote, branch, args);
    }

    public async pushTags(remote: string): Promise<void> {
        await this.git.pushTags(remote);
    }

    public async renameBranch(oldName: string, newName: string): Promise<void> {
        await this.git.branch(['-m', oldName, newName]);
    }

    public async deleteBranches(branches: string[], force: boolean = false): Promise<void> {
        const args = force ? ['-D'] : ['-d'];
        await this.git.branch([...args, ...branches]);
    }

    public async getTags(): Promise<string[]> {
        const tags = await this.git.tags();
        return tags.all;
    }

    public async getGroupedRemoteBranches(): Promise<Record<string, string[]>> {
        const branches = await this.git.branch(['-r']);
        const grouped: Record<string, string[]> = {};

        branches.all.forEach(fullBranchName => {
            // origin/HEAD -> origin/master
            if (fullBranchName.includes('->')) return;

            const parts = fullBranchName.split('/');
            const remote = parts[0];
            const branch = parts.slice(1).join('/');

            if (!grouped[remote]) {
                grouped[remote] = [];
            }
            grouped[remote].push(branch);
        });

        return grouped;
    }

    // RPC methods below (arrow functions for proper 'this' binding)

    public getPushInitState = async (): Promise<PushInitState> => {
        const branches = await this.getBranches();
        const remotes = await this.getRemotes();
        const upstream = await this.getUpstreamBranch(branches.current);

        return {
            localBranch: branches.current,
            remotes: remotes.length > 0 ? remotes : ['origin'],
            upstream: upstream ?? undefined
        };
    };

    public getRemoteBranchesForRemote = async (remote: string): Promise<string[]> => {
        const allRemoteBranches = await this.getRemoteBranches();
        const prefix = `${remote}/`;
        return allRemoteBranches
            .filter(b => b.startsWith(prefix) && !b.includes('HEAD'))
            .map(b => b.substring(prefix.length));
    };

    public getPushCommits = async (params: { remote: string; branch: string; limit?: number; skip?: number }): Promise<PushCommitsData> => {
        const branches = await this.getBranches();
        const currentBranch = branches.current;

        const limit = params.limit ?? 20;
        const skip = params.skip ?? 0;

        const [totalCount, commits] = await Promise.all([
            this.getCommitsToPushCount(currentBranch, params.remote, params.branch),
            this.getCommitsToPush(
                currentBranch,
                params.remote,
                params.branch,
                { maxCount: limit, skip }
            )
        ]);

        // Fetch files for each commit
        const commitsWithFiles = await Promise.all(
            commits.map(async (commit) => {
                const files = await this.getCommitFiles(commit.hash);
                return { ...commit, files };
            })
        );

        const hasMore = (skip + commits.length) < totalCount;

        return {
            commits: commitsWithFiles,
            hasMore,
            totalCount
        };
    };

    public getRpcBranchInfo = async (): Promise<BranchInfo> => {
        const [branches, branchStatus, rebaseStatus] = await Promise.all([
            this.getBranches(),
            this.getBranchStatus(),
            this.getRebaseStatus()
        ]);

        return {
            current: branches.current,
            all: branches.all,
            ahead: branchStatus.ahead,
            behind: branchStatus.behind,
            rebaseStatus
        };
    };

    public getBranchListData = async (): Promise<BranchListData> => {
        const [branches, groupedRemote, tags, aheadBehindMap] = await Promise.all([
            this.getBranches(),
            this.getGroupedRemoteBranches(),
            this.getTags(),
            this.getAllBranchesAheadBehind()
        ]);

        const localBranchesInfo = branches.all.map((branchName) => {
            const info = aheadBehindMap.get(branchName) || { ahead: 0, behind: 0 };
            return {
                name: branchName,
                ahead: info.ahead,
                behind: info.behind,
                upstream: info.upstream
            };
        });

        return {
            currentBranch: branches.current,
            localBranches: branches.all,
            localBranchesInfo,
            remoteBranches: groupedRemote,
            tags: tags
        };
    };

    public getStashFilesAsCommitFiles = async (index: number): Promise<CommitFile[]> => {
        const files = await this.getStashFiles(index);
        return files.map(f => ({ path: f.path, status: f.status as GitStatusCode }));
    };

    public async rebaseOnto(targetBranch: string): Promise<void> {
        await this.withTemporaryStash(`rebase onto ${targetBranch}`, async () => {
            await this.git.rebase([targetBranch]);
        });
    }

    public async merge(branchName: string): Promise<void> {
        await this.git.merge([branchName]);
    }

    public async checkoutAndRebase(branch: string, targetBranch: string): Promise<void> {
        await this.switchBranch(branch);
        await this.rebaseOnto(targetBranch);
    }

    public async pullWithRebase(remote: string, branch: string): Promise<void> {
        await this.withTemporaryStash(`pull --rebase ${remote}/${branch}`, async () => {
            await this.git.raw(['pull', '--rebase', remote, branch]);
        });
    }

    public async pullWithMerge(remote: string, branch: string): Promise<void> {
        await this.git.pull(remote, branch);
    }

    public async createBranchFrom(newBranch: string, fromBranch: string): Promise<void> {
        await this.git.checkout(['-b', newBranch, fromBranch]);
    }

    public async reset(mode: 'soft' | 'mixed' | 'hard', commit: string): Promise<void> {
        await this.git.reset([`--${mode}`, commit]);
        this.fireChange();
    }

    public async cherryPick(commit: string): Promise<void> {
        try {
            await this.git.raw(['cherry-pick', commit]);
            this.fireChange();
        } catch (e: any) {
            // handle conflict or error
            throw e;
        }
    }

    public async revert(commit: string): Promise<void> {
        try {
            // --no-edit to avoid launching editor
            await this.git.revert(commit, ['--no-edit']);
            this.fireChange();
        } catch (e: any) {
            throw e;
        }
    }

    /**
     * Check if a commit has been pushed to any remote branch.
     */
    public async isCommitPushed(commit: string): Promise<boolean> {
        try {
            // Check if commit exists on any remote branch
            const result = await this.git.branch(['-r', '--contains', commit]);
            return result.all.length > 0;
        } catch {
            // If command fails, assume not pushed
            return false;
        }
    }

    public async checkoutCommit(commit: string): Promise<void> {
        await this.git.checkout(commit);
        this.fireChange();
    }

    public getLog = async (options: LogOptions): Promise<LogCommit[]> => {
        try {
            const args = ['log', '--date=iso'];

            // Format: Hash, ShortHash, Subject, Author, Email, Date, Parents, Refs
            // Separator: %x00 (null char) to avoid collision
            const format = '%H%x00%h%x00%s%x00%an%x00%ae%x00%aI%x00%P%x00%D';
            args.push(`--format=${format}`);

            // Check if search looks like a commit hash (7-40 hex characters)
            let searchAsHash: string | null = null;
            if (options.search) {
                const isHexPattern = /^[0-9a-fA-F]{7,40}$/.test(options.search);
                logger.info('[getLog] search:', options.search, 'isHexPattern:', isHexPattern);
                if (isHexPattern) {
                    try {
                        const resolved = await this.git.revparse([options.search]);
                        logger.info('[getLog] revparse result:', resolved);
                        if (resolved && resolved.trim()) {
                            searchAsHash = resolved.trim();
                        }
                    } catch (e) {
                        logger.info('[getLog] revparse error:', e);
                    }
                }
            }

            if (searchAsHash) {
                // Search by commit hash: show only this exact commit
                args.push('-n', '1', searchAsHash);
            } else {
                // Normal search mode
                if (options.maxCount) {
                    args.push(`-n`, options.maxCount.toString());
                }

                if (options.skip) {
                    args.push(`--skip=${options.skip}`);
                }

                if (options.authors && options.authors.length > 0) {
                    const escapeRegex = (s: string) => s.replace(/[[\]{}()*+?.\\^$|]/g, '\\$&');
                    const authorPattern = options.authors.map(escapeRegex).join('\\|');
                    args.push(`--author=${authorPattern}`);
                }

                if (options.search) {
                    if (options.regexMode) {
                        args.push('-E');
                    } else {
                        args.push('--fixed-strings');
                    }
                    args.push(`--grep=${options.search}`);
                    if (!options.caseSensitive) {
                        args.push('-i');
                    }
                }
            }

            // Branch filtering - skip if searching by hash (hash already specifies the commit)
            if (!searchAsHash) {
                if (options.branch) {
                    if (options.branch === 'all') {
                        args.push('--all');
                    } else if (options.branch === 'HEAD') {
                        // Default behavior (HEAD and ancestry)
                    } else if (options.branch.includes(',')) {
                        // Multiple branches: split and add each as separate argument
                        const branches = options.branch.split(',').map(b => b.trim()).filter(Boolean);
                        args.push(...branches);
                    } else {
                        args.push(options.branch);
                    }
                } else {
                    args.push('--all');
                }
            }

            if (options.since) {
                args.push(`--since=${options.since}`);
            }
            if (options.until) {
                args.push(`--until=${options.until}`);
            }



            // Graph order matters. --topo-order is good for graphs.
            args.push('--topo-order');

            // Path filtering: supports multiple paths
            if (options.paths && options.paths.length > 0) {
                args.push('--', ...options.paths.map(p => this.toRepoPath(p)));
            } else if (options.fileFilter) {
                args.push('--', this.toRepoPath(options.fileFilter));
            }

            logger.info('[getLog] git', args.join(' '));
            const result = await this.git.raw(args);

            if (!result) return [];

            const commits: LogCommit[] = result.split('\n')
                .filter(line => line.trim())
                .map(line => {
                    const [hash, shortHash, subject, authorName, authorEmail, date, parentsStr, refsStr] = line.split('\0');

                    return {
                        hash,
                        shortHash,
                        subject,
                        authorName,
                        authorEmail,
                        date,
                        parentHashes: parentsStr ? parentsStr.split(' ') : [],
                        refs: this._parseRefs(refsStr),
                        body: '',
                        files: [],
                        stats: { additions: 0, deletions: 0 },
                        containingBranches: [],
                        filteredAncestors: []
                    };
                });

            // In filtered mode (search or specific branch), calculate filteredAncestors using in-memory graph
            const isFilteredMode = !!options.search || (options.branch && options.branch !== 'all' && options.branch !== 'HEAD');

            if (isFilteredMode && commits.length > 1) {
                await this.ensureGraphLoaded();

                const commitHashToIdx = new Map<string, number>();
                commits.forEach((c, i) => commitHashToIdx.set(c.hash, i));

                for (let i = 0; i < commits.length; i++) {
                    const commit = commits[i];

                    // Check if any direct parent is visible
                    const hasVisibleParent = commit.parentHashes.some(ph => commitHashToIdx.has(ph));

                    if (!hasVisibleParent) {
                        // Use BFS to find the nearest visible ancestor
                        // We only care about ancestors that appear LATER in the list (idx > i)
                        const visibleAncestor = this.findNearestVisibleAncestor(commit.hash, new Set(commits.slice(i + 1).map(c => c.hash)));

                        if (visibleAncestor) {
                            commit.filteredAncestors = [visibleAncestor];
                        }
                    }
                }
            }

            return commits;
        } catch (e) {
            console.error('getLog error:', e);
            return [];
        }
    }

    getAuthors = async (): Promise<string[]> => {
        if (!this.git) return [];

        const root = this.getWorkspaceRoot();
        if (!root) return [];

        try {
            const logResult = await this.git.raw(['log', '--format=%aN']);
            if (!logResult) return [];

            const authors = new Set(logResult.split('\n').map(a => a.trim()).filter(a => !!a));
            return Array.from(authors).sort();
        } catch (e) {
            console.error('getAuthors error:', e);
            return [];
        }
    }

    getCurrentUser = async (): Promise<string> => {
        if (!this.git) return '';
        try {
            const result = await this.git.raw(['config', 'user.name']);
            return result ? result.trim() : '';
        } catch (e) {
            console.error('getCurrentUser error:', e);
            return '';
        }
    }

    private graphCache: Map<string, string[]> | null = null;

    private async ensureGraphLoaded(): Promise<void> {
        if (this.graphCache) return;

        try {
            // Load all commits with their parents: "hash parent1 parent2..."
            const result = await this.git.raw(['rev-list', '--all', '--parents']);
            this.graphCache = new Map();

            result.split('\n').forEach(line => {
                if (!line) return;
                const parts = line.split(' ');
                const hash = parts[0];
                const parents = parts.slice(1);
                this.graphCache!.set(hash, parents);
            });
        } catch (e) {
            console.error('Failed to load commit graph:', e);
            this.graphCache = new Map();
        }
    }

    private findNearestVisibleAncestor(startHash: string, visibleHashes: Set<string>): string | null {
        if (!this.graphCache) return null;

        const queue: string[] = [...(this.graphCache.get(startHash) || [])];
        const visited = new Set<string>();

        let iterations = 0;
        const MAX_SEARCH_DEPTH = 5000;

        while (queue.length > 0) {
            iterations++;
            if (iterations > MAX_SEARCH_DEPTH) break;

            const current = queue.shift()!;
            if (visited.has(current)) continue;
            visited.add(current);

            if (visibleHashes.has(current)) {
                return current;
            }

            const parents = this.graphCache.get(current);
            if (parents) {
                for (const p of parents) {
                    if (!visited.has(p)) {
                        queue.push(p);
                    }
                }
            }
        }

        return null;
    }

    public getCommitDetails = async (hash: string): Promise<CommitDetails> => {
        try {
            const showMsg = await this.git.show([hash, '--format=%B%x00%P%x00%an%x00%ae%x00%aI%x00%h', '--no-patch']);
            const [fullMessage, parentsStr, authorName, authorEmail, date, shortHash] = showMsg.split('\0');

            const files = await this.getCommitFiles(hash) as CommitFile[];

            // Get containing branches
            let containingBranches: string[] = [];
            try {
                const branchOutput = await this.git.branch(['--contains', hash]);
                containingBranches = branchOutput.all;
            } catch {
                // Ignore error if commit is not reachable
            }

            const shortstat = await this.git.show([hash, '--format=', '--shortstat']);
            let additions = 0;
            let deletions = 0;
            if (shortstat) {
                const addMatch = shortstat.match(/(\d+) insertion/);
                const delMatch = shortstat.match(/(\d+) deletion/);
                if (addMatch) additions = parseInt(addMatch[1], 10);
                if (delMatch) deletions = parseInt(delMatch[1], 10);
            }

            // Split fullMessage into subject and body
            const messageLines = (fullMessage?.trim() || '').split('\n');
            const subject = messageLines[0] || '';
            const body = messageLines.slice(1).join('\n').trim() || undefined;

            return {
                hash,
                shortHash: shortHash?.trim() || hash.substring(0, 8),
                subject,
                body: body || '',
                files,
                stats: { additions, deletions },
                parentHashes: parentsStr ? parentsStr.trim().split(' ') : [],
                authorName: authorName?.trim() || '',
                authorEmail: authorEmail?.trim() || '',
                date: date?.trim() || '',
                containingBranches,
                refs: [],
                filteredAncestors: []
            };
        } catch (e) {
            console.error('getCommitDetails error:', e);
            throw e;
        }
    }

    private _parseRefs(refsStr: string): RefInfo[] {
        if (!refsStr) return [];

        return refsStr.split(', ').filter(Boolean).map(ref => {
            ref = ref.trim();
            if (ref.startsWith('HEAD -> ')) {
                return { name: ref.replace('HEAD -> ', ''), type: 'head' };
            }
            if (ref.startsWith('tag: ')) {
                return { name: ref.replace('tag: ', ''), type: 'tag' };
            }
            if (ref.includes('/')) {
                return { name: ref, type: 'remote' };
            }
            return { name: ref, type: 'local' };
        });
    }
}
export { FileStatus };
