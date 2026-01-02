import simpleGit, { SimpleGit, StatusResult } from 'simple-git';
import { BranchInfo } from '../shared/messages';
import * as fs from 'fs';
import * as path from 'path';

export interface FileStatus {
    path: string;
    status: string;
    staged: boolean;
}

export interface CommitInfo {
    hash: string;
    shortHash: string;
    subject: string;
    authorName: string;
    date: string;
    email?: string;
    fullHash?: string;
}

export class GitService {
    private git: SimpleGit;
    private _workspaceRoot: string;

    constructor(workspaceRoot: string) {
        this._workspaceRoot = workspaceRoot;
        this.git = simpleGit(workspaceRoot);
    }

    public getWorkspaceRoot(): string {
        return this._workspaceRoot;
    }

    public async getStatus(): Promise<FileStatus[]> {
        const files: FileStatus[] = [];

        try {
            const status: StatusResult = await this.git.status();

            status.staged.forEach(file => {
                files.push({
                    path: file,
                    status: 'A',
                    staged: true
                });
            });

            status.modified.forEach(file => {
                const isStaged = status.staged.includes(file);
                if (!isStaged) {
                    files.push({
                        path: file,
                        status: 'M',
                        staged: false
                    });
                }
            });

            status.deleted.forEach(file => {
                const isStaged = status.staged.includes(file);
                if (!isStaged) {
                    files.push({
                        path: file,
                        status: 'D',
                        staged: false
                    });
                }
            });

            status.not_added.forEach(file => {
                files.push({
                    path: file,
                    status: '?',
                    staged: false
                });
            });

            status.renamed.forEach(renamed => {
                files.push({
                    path: renamed.to,
                    status: 'R',
                    staged: true
                });
            });

            status.conflicted.forEach(file => {
                files.push({
                    path: file,
                    status: 'C',
                    staged: true // Conflicts are typically considered staged/in-index
                });
            });

            // Also check raw status for 'U' (Unmerged) which simple-git might map differently
            // We'll rely on simple-git's .conflicted array first, but if indexStatus has 'U', handle it.
            const indexStatus = await this.git.diff(['--cached', '--name-status']);
            indexStatus.split('\n').forEach(line => {
                if (!line) return;
                const [statusCode, filePath] = line.split('\t');
                const existing = files.find(f => f.path === filePath);

                // If it's a conflict
                if ((statusCode === 'U' || statusCode.startsWith('U') || statusCode.endsWith('U'))) {
                    if (existing) {
                        existing.status = 'C';
                        existing.staged = true;
                    } else if (filePath) {
                        files.push({
                            path: filePath,
                            status: 'C',
                            staged: true
                        });
                    }
                    return;
                }

                if (!existing && filePath) {
                    files.push({
                        path: filePath,
                        status: statusCode,
                        staged: true
                    });
                } else if (existing && existing.status !== 'C') { // Don't overwrite conflict status
                    existing.status = statusCode;
                }
            });

        } catch (e) {
            console.error('Error getting status:', e);
        }

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

    public async switchBranch(branchName: string): Promise<void> {
        await this.git.checkout(branchName);
    }

    public async stageFile(filePath: string): Promise<void> {
        await this.git.add(filePath);
    }

    public async unstageFile(filePath: string): Promise<void> {
        await this.git.reset(['HEAD', '--', filePath]);
    }

    public async stageAll(): Promise<void> {
        await this.git.add('-A');
    }

    public async unstageAll(): Promise<void> {
        await this.git.reset(['HEAD']);
    }

    public async stash(message?: string, files?: string[]): Promise<void> {
        const args = ['push'];
        if (message) {
            args.push('-m', message);
        }
        if (files && files.length > 0) {
            args.push('--', ...files);
        }
        await this.git.stash(args);
    }

    public async rollbackFiles(files: string[]): Promise<void> {
        if (!files || files.length === 0) {
            return;
        }

        try {
            // We need to know the status of these files to decide how to rollback
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

            // Execute actions
            if (toCheckout.length > 0) {
                await this.git.checkout(['HEAD', '--', ...toCheckout]);
            }

            if (toReset.length > 0) {
                // Just unstage, keep the file as untracked
                await this.git.reset(['HEAD', '--', ...toReset]);
            }

            if (toClean.length > 0) {
                // Remove untracked files
                await this.git.clean('f', ['-d', '--', ...toClean]);
            }
        } catch (e) {
            console.error('Rollback failed:', e);
            throw e;
        }
    }

    public async getStashList(): Promise<Array<{ index: number, message: string, branch: string }>> {
        try {
            const result = await this.git.stashList();
            console.log('simple-git stashList result:', JSON.stringify(result));
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

    public async getStashFiles(index: number): Promise<Array<{ path: string, status: string }>> {
        try {
            const result = await this.git.raw(['stash', 'show', '--name-status', `stash@{${index}}`]);
            const files: Array<{ path: string, status: string }> = [];
            for (const line of result.split('\n')) {
                if (!line.trim()) continue;
                const parts = line.split('\t');
                if (parts.length >= 2) {
                    files.push({
                        status: parts[0],
                        path: parts[1]
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

    public async getFileContent(ref: string, relativePath: string): Promise<string> {
        try {
            return await this.git.show([`${ref}:${relativePath}`]);
        } catch (e: any) {
            // If file doesn't exist in the revision (e.g. Added file), return empty string
            if (e.message && (e.message.includes('does not exist') || e.message.includes('exists on disk'))) {
                return '';
            }
            console.error('getFileContent error:', e);
            return '';
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

    public async commit(message: string, files?: string[]): Promise<void> {
        if (files && files.length > 0) {
            await this.git.commit(message, files);
        } else {
            await this.git.commit(message);
        }
    }

    public async commitAmend(message?: string, files?: string[]): Promise<void> {
        const options: string[] = ['--amend'];
        if (message) {
            options.push('-m', message);
        } else {
            options.push('--no-edit');
        }

        if (files && files.length > 0) {
            await this.git.commit([...options, ...files]);
        } else {
            await this.git.commit(options);
        }
    }

    public async getLastCommitMessage(): Promise<string> {
        try {
            const log = await this.git.log({ maxCount: 1 });
            return log.latest?.message || '';
        } catch {
            return '';
        }
    }

    public async push(remote: string, branch: string): Promise<void> {
        await this.git.push(remote, branch);
    }

    public async pull(): Promise<void> {
        await this.git.pull();
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
                    const trackedDiff = await this.git.diff(['HEAD', '--', ...trackedFiles]);
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
            return { ahead: 0, behind: 0 };
        }
    }

    public async createBranch(branchName: string): Promise<void> {
        await this.git.checkoutLocalBranch(branchName);
    }

    public async checkoutRemoteBranch(remoteBranch: string): Promise<void> {
        const parts = remoteBranch.split('/');
        const localBranchName = parts.slice(1).join('/');

        const localBranches = await this.getBranches();
        if (localBranches.all.includes(localBranchName)) {
            await this.git.checkout(localBranchName);
        } else {
            await this.git.checkout(['-b', localBranchName, '--track', remoteBranch]);
        }
    }


    public async getCommitsToPush(
        localBranch: string,
        remote: string,
        remoteBranch: string
    ): Promise<CommitInfo[]> {
        try {
            const hasRemoteBranch = await this._remoteBranchExists(remote, remoteBranch);

            if (hasRemoteBranch) {
                const log = await this.git.log({
                    from: `${remote}/${remoteBranch}`,
                    to: localBranch
                });

                return log.all.map(commit => ({
                    hash: commit.hash,
                    shortHash: commit.hash.substring(0, 8),
                    subject: commit.message,
                    authorName: commit.author_name,
                    date: commit.date,
                    email: commit.author_email,
                    fullHash: commit.hash
                }));
            } else {
                // New remote branch: get commits not reachable from any remote
                return this._getCommitsNotInRemote(localBranch, 20);
            }
        } catch (e) {
            console.error('Error getting commits to push:', e);
            return [];
        }
    }

    private async _getCommitsNotInRemote(branch: string, maxCount: number): Promise<CommitInfo[]> {
        try {
            const result = await this.git.raw([
                'log',
                branch,
                '--not',
                '--remotes',
                `--max-count=${maxCount}`,
                '--format=%H|%h|%s|%an|%aI|%ae'
            ]);

            if (!result.trim()) {
                return [];
            }

            return result.trim().split('\n').map(line => {
                const [hash, shortHash, subject, authorName, date, email] = line.split('|');
                return { hash, shortHash, subject, authorName, date, email, fullHash: hash };
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

    private async _getRecentCommits(count: number): Promise<CommitInfo[]> {
        try {
            const log = await this.git.log({ maxCount: count });
            return log.all.map(commit => ({
                hash: commit.hash,
                shortHash: commit.hash.substring(0, 8),
                subject: commit.message,
                authorName: commit.author_name,
                date: commit.date,
                email: commit.author_email,
                fullHash: commit.hash
            }));
        } catch {
            return [];
        }
    }

    public async getRebaseStatus(): Promise<'none' | 'interactive' | 'merging'> {
        try {
            // Check for rebase/merge directories
            // .git/rebase-merge exists during interactive rebase
            // .git/rebase-apply exists during standard rebase
            // OR use git status
            const statusSummary = await this.git.status();

            if (statusSummary.current === 'HEAD' && statusSummary.tracking === null) {
                // Often indicates detached HEAD functionality, possibly rebase
            }

            // Simple-git doesn't explicitly flag "rebase interactive", but we can infer or use raw
            try {
                // Check if rebase directory exists (cannot depend on fs directly easily without path, use git rev-parse --git-dir)
                // Using raw command to check status text or looking for specific files is safer via git
                const gitDir = await this.git.revparse(['--git-dir']);

                // We'll rely on fs access via vscode (pass fs or check via hacks? no, we have workspaceRoot)
                // Let's use `git status` output text as the user showed in the issue
                // "interactive rebase in progress"

                // Actually simple-git status result might have info?
                // Unfortunately no standard property.
                // Let's parse `git status` short output? No, that's what .status() does.

                // Let's use raw git status to check
                const statusText = await this.git.raw(['status']);
                if (statusText.includes('interactive rebase in progress')) {
                    return 'interactive';
                }
                if (statusText.includes('rebase in progress')) {
                    return 'interactive'; // Treat as interactive for UI purposes (show abort)
                }
                if (statusText.includes('You have unmerged paths')) {
                    return 'merging';
                }
            } catch {
                // ignore
            }

            return 'none';
        } catch {
            return 'none';
        }
    }

    public async abortRebase(): Promise<void> {
        await this.git.rebase(['--abort']);
    }

    public async continueRebase(message?: string): Promise<void> {
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

        // Use .env() to set GIT_EDITOR for this operation
        await this.git.env({ ...process.env, GIT_EDITOR: 'true' }).rebase(['--continue']);
    }

    public async getRebaseCommitMessage(): Promise<string> {
        try {
            let gitDir = (await this.git.revparse(['--git-dir'])).trim();

            // Ensure gitDir is absolute
            if (!path.isAbsolute(gitDir) && this._workspaceRoot) {
                gitDir = path.join(this._workspaceRoot, gitDir);
            }

            console.log('rebaseMergeMsg gitDir', gitDir);

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

    public async getCommitFiles(hash: string): Promise<{ path: string; status: string }[]> {
        try {
            const result = await this.git.show([hash, '--name-status', '--pretty=format:']);
            const lines = result.split('\n').filter(l => l.trim());
            return lines.map(line => {
                const [status, ...pathParts] = line.split('\t');
                return {
                    path: pathParts.join('\t'),
                    status: status
                };
            });
        } catch (e) {
            console.error('Error getting commit files:', e);
            return [];
        }
    }

    public async forcePush(remote: string, branch: string): Promise<void> {
        await this.git.push(remote, branch, ['--force']);
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
}
