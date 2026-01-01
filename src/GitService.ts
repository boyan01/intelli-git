import simpleGit, { SimpleGit, StatusResult } from 'simple-git';

export interface FileStatus {
    path: string;
    status: string;
    staged: boolean;
}

export interface BranchInfo {
    current: string;
    all: string[];
}

export interface CommitInfo {
    hash: string;
    fullHash: string;
    message: string;
    author: string;
    email: string;
    date: string;
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

            const indexStatus = await this.git.diff(['--cached', '--name-status']);
            indexStatus.split('\n').forEach(line => {
                if (!line) return;
                const [statusCode, filePath] = line.split('\t');
                const existing = files.find(f => f.path === filePath && f.staged);
                if (!existing && filePath) {
                    files.push({
                        path: filePath,
                        status: statusCode,
                        staged: true
                    });
                } else if (existing) {
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

    public async getStashList(): Promise<Array<{index: number, message: string, branch: string}>> {
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

    public async getStashFiles(index: number): Promise<Array<{path: string, status: string}>> {
        try {
            const result = await this.git.raw(['stash', 'show', '--name-status', `stash@{${index}}`]);
            const files: Array<{path: string, status: string}> = [];
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
        } catch (e) {
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
            if (!hasRemoteBranch) {
                return this._getRecentCommits(5);
            }

            const log = await this.git.log({
                from: `${remote}/${remoteBranch}`,
                to: localBranch
            });

            return log.all.map(commit => ({
                hash: commit.hash.substring(0, 8),
                fullHash: commit.hash,
                message: commit.message,
                author: commit.author_name,
                email: commit.author_email,
                date: commit.date
            }));
        } catch (e) {
            console.error('Error getting commits to push:', e);
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
                hash: commit.hash.substring(0, 8),
                fullHash: commit.hash,
                message: commit.message,
                author: commit.author_name,
                email: commit.author_email,
                date: commit.date
            }));
        } catch {
            return [];
        }
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
}

