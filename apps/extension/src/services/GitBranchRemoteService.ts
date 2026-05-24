import simpleGit, { type SimpleGit } from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';
import type {
    BranchInfo,
    BranchListData,
    CommitDetails,
    CommitFile,
    PushCommitsData,
    PushInitState,
    RemoteLinkCapabilities,
    RemoteLinkInfo,
    RemoteProvider,
    WorktreeInfo
} from '@shared/messages';
import { logger } from '../utils/logger';

const GIT_LOG_RECORD_SEPARATOR = '\x1e';
const GIT_LOG_FIELD_SEPARATOR = '\x1f';
const PUSH_COMMIT_LOG_FORMAT = '%x1e%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1f%ae%x1f%P%x1f%b';
const UNKNOWN_REMOTE_LINK_CAPABILITIES: RemoteLinkCapabilities = {
    commit: false,
    branch: false,
    file: false,
    compare: false
};
const COMMON_REMOTE_LINK_CAPABILITIES: RemoteLinkCapabilities = {
    commit: true,
    branch: true,
    file: true,
    compare: true
};
const PARTIAL_REMOTE_LINK_CAPABILITIES: RemoteLinkCapabilities = {
    commit: true,
    branch: true,
    file: true,
    compare: false
};

export interface GitBranchRemoteServiceOptions {
    git: SimpleGit;
    gitRoot: string;
    notifyChanged: () => void;
    withTemporaryStash: (operationName: string, operation: () => Promise<void>) => Promise<void>;
    createEditorGit: (envOverrides: NodeJS.ProcessEnv) => SimpleGit;
    getCommitFiles: (hash: string) => Promise<CommitFile[]>;
}

export interface WorktreeBranchUsage {
    branch: string;
    path: string;
    pathExists: boolean;
    isPrunable: boolean;
}

interface WorktreeRecord {
    path: string;
    head?: string;
    branch?: string;
    isDetached?: boolean;
    isBare?: boolean;
    isPrunable?: boolean;
}

interface ParsedRemoteUrl {
    hostname: string;
    pathParts: string[];
}

function stripGitSuffix(value: string): string {
    return value.trim().replace(/\.git\/?$/, '').replace(/\/+$/, '');
}

function splitRemotePath(pathname: string): string[] {
    return stripGitSuffix(pathname)
        .replace(/^\/+|\/+$/g, '')
        .split('/')
        .filter(Boolean);
}

function decodeRemotePathPart(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function parseRemoteUrl(remoteUrl: string): ParsedRemoteUrl | undefined {
    const normalized = stripGitSuffix(remoteUrl);
    if (!normalized) {
        return undefined;
    }

    try {
        const url = new URL(normalized);
        return {
            hostname: url.hostname.toLowerCase(),
            pathParts: splitRemotePath(url.pathname).map(decodeRemotePathPart)
        };
    } catch {
        const sshMatch = normalized.match(/^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/);
        if (!sshMatch) {
            return undefined;
        }

        return {
            hostname: sshMatch[1].toLowerCase(),
            pathParts: splitRemotePath(sshMatch[2]).map(decodeRemotePathPart)
        };
    }
}

function createRemoteLinkInfo(
    provider: RemoteProvider,
    repositoryUrl: string,
    capabilities: RemoteLinkCapabilities
): RemoteLinkInfo {
    return { provider, repositoryUrl, capabilities };
}

function getUnknownRemoteLinkInfo(): RemoteLinkInfo {
    return { provider: 'unknown', capabilities: UNKNOWN_REMOTE_LINK_CAPABILITIES };
}

function getRemoteLinkInfo(remoteUrl: string): RemoteLinkInfo {
    const parsed = parseRemoteUrl(remoteUrl);
    if (!parsed) {
        return getUnknownRemoteLinkInfo();
    }

    const { hostname, pathParts } = parsed;

    if (hostname === 'github.com' && pathParts.length >= 2) {
        return createRemoteLinkInfo(
            'github',
            `https://github.com/${encodePath(pathParts[0])}/${encodePath(pathParts[1])}`,
            COMMON_REMOTE_LINK_CAPABILITIES
        );
    }

    if ((hostname === 'gitlab.com' || hostname.includes('gitlab')) && pathParts.length >= 2) {
        return createRemoteLinkInfo(
            'gitlab',
            `https://${hostname}/${pathParts.map(encodePath).join('/')}`,
            COMMON_REMOTE_LINK_CAPABILITIES
        );
    }

    if (hostname === 'bitbucket.org' && pathParts.length >= 2) {
        return createRemoteLinkInfo(
            'bitbucket',
            `https://bitbucket.org/${encodePath(pathParts[0])}/${encodePath(pathParts[1])}`,
            PARTIAL_REMOTE_LINK_CAPABILITIES
        );
    }

    if (hostname === 'dev.azure.com' && pathParts.length >= 4 && pathParts[2] === '_git') {
        return createRemoteLinkInfo(
            'azure',
            `https://dev.azure.com/${encodePath(pathParts[0])}/${encodePath(pathParts[1])}/_git/${encodePath(pathParts[3])}`,
            PARTIAL_REMOTE_LINK_CAPABILITIES
        );
    }

    if (hostname.endsWith('.visualstudio.com') && pathParts.length >= 3 && pathParts[1] === '_git') {
        return createRemoteLinkInfo(
            'azure',
            `https://${hostname}/${encodePath(pathParts[0])}/_git/${encodePath(pathParts[2])}`,
            PARTIAL_REMOTE_LINK_CAPABILITIES
        );
    }

    if (hostname === 'ssh.dev.azure.com' && pathParts.length >= 4 && pathParts[0] === 'v3') {
        return createRemoteLinkInfo(
            'azure',
            `https://dev.azure.com/${encodePath(pathParts[1])}/${encodePath(pathParts[2])}/_git/${encodePath(pathParts[3])}`,
            PARTIAL_REMOTE_LINK_CAPABILITIES
        );
    }

    return getUnknownRemoteLinkInfo();
}

function encodePath(value: string): string {
    return value.split('/').map(part => encodeURIComponent(part)).join('/');
}

function createQueryString(params: Record<string, string>): string {
    return new URLSearchParams(params).toString();
}

function getAzureVersion(ref: string): string {
    return /^[0-9a-f]{7,40}$/i.test(ref) ? `GC${ref}` : `GB${ref}`;
}

function getRemoteCommitUrl(remoteLink: RemoteLinkInfo, hash: string): string | undefined {
    if (!remoteLink.repositoryUrl || !remoteLink.capabilities.commit) {
        return undefined;
    }

    if (remoteLink.provider === 'bitbucket') {
        return `${remoteLink.repositoryUrl}/commits/${encodePath(hash)}`;
    }

    if (remoteLink.provider === 'gitlab') {
        return `${remoteLink.repositoryUrl}/-/commit/${encodePath(hash)}`;
    }

    return `${remoteLink.repositoryUrl}/commit/${encodePath(hash)}`;
}

function getRemoteBranchUrl(remoteLink: RemoteLinkInfo, branch: string): string | undefined {
    if (!remoteLink.repositoryUrl || !remoteLink.capabilities.branch) {
        return undefined;
    }

    if (remoteLink.provider === 'bitbucket') {
        return `${remoteLink.repositoryUrl}/src/${encodePath(branch)}/`;
    }

    if (remoteLink.provider === 'azure') {
        return `${remoteLink.repositoryUrl}?${createQueryString({ version: `GB${branch}` })}`;
    }

    const treeSegment = remoteLink.provider === 'gitlab' ? '-/tree' : 'tree';
    return `${remoteLink.repositoryUrl}/${treeSegment}/${encodePath(branch)}`;
}

function getRemoteFileUrl(remoteLink: RemoteLinkInfo, ref: string, filePath: string): string | undefined {
    if (!remoteLink.repositoryUrl || !remoteLink.capabilities.file) {
        return undefined;
    }

    if (remoteLink.provider === 'bitbucket') {
        return `${remoteLink.repositoryUrl}/src/${encodePath(ref)}/${encodePath(filePath)}`;
    }

    if (remoteLink.provider === 'azure') {
        return `${remoteLink.repositoryUrl}?${createQueryString({ path: `/${filePath}`, version: getAzureVersion(ref) })}`;
    }

    const blobSegment = remoteLink.provider === 'gitlab' ? '-/blob' : 'blob';
    return `${remoteLink.repositoryUrl}/${blobSegment}/${encodePath(ref)}/${encodePath(filePath)}`;
}

function getRemoteCompareUrl(remoteLink: RemoteLinkInfo, base: string, head: string): string | undefined {
    if (!remoteLink.repositoryUrl || !remoteLink.capabilities.compare) {
        return undefined;
    }

    const compareSegment = remoteLink.provider === 'gitlab' ? '-/compare' : 'compare';
    return `${remoteLink.repositoryUrl}/${compareSegment}/${encodePath(base)}...${encodePath(head)}`;
}

function normalizePath(filePath: string): string {
    try {
        return path.normalize(fs.realpathSync(filePath));
    } catch {
        return path.normalize(filePath);
    }
}

function parseWorktreeList(output: string): WorktreeRecord[] {
    const records: WorktreeRecord[] = [];
    let current: WorktreeRecord | undefined;

    const finishRecord = () => {
        if (current?.path) {
            records.push(current);
        }
        current = undefined;
    };

    for (const line of output.split(/\r?\n/)) {
        if (line.startsWith('worktree ')) {
            finishRecord();
            current = { path: line.substring('worktree '.length) };
            continue;
        }

        if (!current) {
            continue;
        }

        if (line.startsWith('branch ')) {
            current.branch = line.substring('branch '.length).replace(/^refs\/heads\//, '');
        } else if (line.startsWith('HEAD ')) {
            current.head = line.substring('HEAD '.length);
        } else if (line === 'detached') {
            current.isDetached = true;
        } else if (line === 'bare') {
            current.isBare = true;
        } else if (line.startsWith('prunable')) {
            current.isPrunable = true;
        }
    }

    finishRecord();
    return records;
}

function parseWorktreeCheckoutError(error: unknown): { branch: string; path: string } | undefined {
    const match = String(error).match(/fatal:\s+'([^']+)'\s+is already used by worktree at '([^']+)'/);
    if (!match) {
        return undefined;
    }

    return {
        branch: match[1],
        path: match[2]
    };
}

export class GitBranchRemoteService {
    constructor(private readonly options: GitBranchRemoteServiceOptions) { }

    public async getWorktreeBranchUsage(branchName: string): Promise<WorktreeBranchUsage | undefined> {
        const records = await this.readWorktreeRecords();
        const currentGitRoot = normalizePath(this.options.gitRoot);
        const record = records.find(item => (
            !item.isBare &&
            item.branch === branchName &&
            normalizePath(item.path) !== currentGitRoot
        ));

        if (!record) {
            return undefined;
        }

        return this.toWorktreeBranchUsage(branchName, record.path, Boolean(record.isPrunable));
    }

    public async resolveWorktreeBranchUsage(branchName: string, error: unknown): Promise<WorktreeBranchUsage | undefined> {
        try {
            const usage = await this.getWorktreeBranchUsage(branchName);
            if (usage) {
                return usage;
            }
        } catch (e) {
            logger.debug(`Failed to inspect worktree usage for branch ${branchName}`, e);
        }

        const parsed = parseWorktreeCheckoutError(error);
        if (!parsed || parsed.branch !== branchName) {
            return undefined;
        }

        return this.toWorktreeBranchUsage(parsed.branch, parsed.path, false);
    }

    public async pruneWorktrees(): Promise<void> {
        await this.options.git.raw(['worktree', 'prune']);
        this.options.notifyChanged();
    }

    public async getWorktrees(activeRepositoryPath?: string): Promise<WorktreeInfo[]> {
        const records = await this.readWorktreeRecords();
        const currentGitRoot = normalizePath(this.options.gitRoot);
        const activePath = activeRepositoryPath ? normalizePath(activeRepositoryPath) : currentGitRoot;
        const worktrees: WorktreeInfo[] = [];

        for (const record of records) {
            if (record.isBare) {
                continue;
            }

            const worktreePath = normalizePath(record.path);
            const pathExists = fs.existsSync(worktreePath);
            worktrees.push({
                path: worktreePath,
                branch: record.branch,
                head: record.head,
                isDetached: Boolean(record.isDetached),
                isCurrent: worktreePath === currentGitRoot,
                isActiveRepository: worktreePath === activePath,
                pathExists,
                isPrunable: Boolean(record.isPrunable),
                isDirty: pathExists ? await this.isWorktreeDirty(worktreePath) : false
            });
        }

        return worktrees;
    }

    public async removeWorktree(worktreePath: string, force: boolean = false): Promise<void> {
        const normalizedPath = normalizePath(worktreePath);
        if (normalizedPath === normalizePath(this.options.gitRoot)) {
            throw new Error('Cannot remove the current worktree.');
        }

        if (!fs.existsSync(normalizedPath)) {
            throw new Error('Cannot remove a missing worktree. Prune stale worktrees instead.');
        }

        if (!force && await this.isWorktreeDirty(normalizedPath)) {
            throw new Error('Cannot remove a worktree with local changes.');
        }

        const args = ['worktree', 'remove'];
        if (force) {
            args.push('--force');
        }
        args.push(normalizedPath);

        await this.options.git.raw(args);
        this.options.notifyChanged();
    }

    public async getBranches(): Promise<BranchInfo> {
        try {
            const branchSummary = await this.options.git.branchLocal();
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
            await this.options.git.checkout(['-f', branchName]);
            this.options.notifyChanged();
            return;
        }

        await this.options.withTemporaryStash(`switch branch ${branchName}`, async () => {
            await this.options.git.checkout(branchName);
        });
    }

    private toWorktreeBranchUsage(branch: string, worktreePath: string, isPrunable: boolean): WorktreeBranchUsage {
        return {
            branch,
            path: normalizePath(worktreePath),
            pathExists: fs.existsSync(worktreePath),
            isPrunable
        };
    }

    private async readWorktreeRecords(): Promise<WorktreeRecord[]> {
        const output = await this.options.git.raw(['worktree', 'list', '--porcelain']);
        return parseWorktreeList(output);
    }

    private async isWorktreeDirty(worktreePath: string): Promise<boolean> {
        try {
            const git = simpleGit(worktreePath);
            if (!await git.checkIsRepo()) {
                return false;
            }
            const status = await git.status();
            return status.files.length > 0;
        } catch (e) {
            logger.debug(`Failed to inspect worktree status for ${worktreePath}`, e);
            return false;
        }
    }

    public async push(remote: string, branch: string, options?: { noVerify?: boolean; setUpstream?: boolean }): Promise<void> {
        const args: string[] = [];
        if (options?.setUpstream) {
            args.push('--set-upstream');
        }
        if (options?.noVerify) {
            args.push('--no-verify');
        }
        await this.options.git.push(remote, branch, args);
        this.options.notifyChanged();
    }

    public async forcePush(remote: string, branch: string, options?: { noVerify?: boolean; setUpstream?: boolean }): Promise<void> {
        const args: string[] = ['--force-with-lease'];
        if (options?.setUpstream) {
            args.push('--set-upstream');
        }
        if (options?.noVerify) {
            args.push('--no-verify');
        }
        await this.options.git.push(remote, branch, args);
        this.options.notifyChanged();
    }

    public async pushTags(remote: string): Promise<void> {
        await this.options.git.pushTags(remote);
        this.options.notifyChanged();
    }

    public async setUpstreamBranch(remote: string, remoteBranch: string): Promise<void> {
        await this.options.git.raw(['branch', '--set-upstream-to', `${remote}/${remoteBranch}`]);
        this.options.notifyChanged();
    }

    public async getUpstreamBranch(localBranch?: string): Promise<string | null> {
        try {
            const branchArg = localBranch ? localBranch : 'HEAD';
            const result = await this.options.git.raw(['rev-parse', '--abbrev-ref', `${branchArg}@{upstream}`]);
            return result.trim() || null;
        } catch {
            return null;
        }
    }

    public async pull(): Promise<void> {
        await this.options.withTemporaryStash('pull --rebase', async () => {
            await this.options.git.raw(['pull', '--rebase']);
        });
    }

    public async getRemotes(): Promise<string[]> {
        try {
            const remotes = await this.options.git.getRemotes();
            return remotes.map(r => r.name);
        } catch (e) {
            console.error('Error getting remotes:', e);
            return [];
        }
    }

    public async getRemoteLinkInfo(): Promise<RemoteLinkInfo> {
        const remotes = await this.options.git.getRemotes(true);
        for (const remote of remotes) {
            const refs = remote.refs as { fetch?: string; push?: string };
            const remoteUrl = refs.fetch || refs.push;
            if (!remoteUrl) {
                continue;
            }

            const remoteLink = getRemoteLinkInfo(remoteUrl);
            if (remoteLink.provider !== 'unknown') {
                return remoteLink;
            }
        }

        return getUnknownRemoteLinkInfo();
    }

    public async getGitHubRepositoryUrl(): Promise<string | undefined> {
        const remoteLink = await this.getRemoteLinkInfo();
        return remoteLink.provider === 'github' ? remoteLink.repositoryUrl : undefined;
    }

    public async getRemoteProvider(): Promise<RemoteProvider> {
        const remoteLink = await this.getRemoteLinkInfo();
        return remoteLink.provider;
    }

    public async getRemoteCommitUrl(hash: string): Promise<string | undefined> {
        return getRemoteCommitUrl(await this.getRemoteLinkInfo(), hash);
    }

    public async getRemoteBranchUrl(branch: string): Promise<string | undefined> {
        return getRemoteBranchUrl(await this.getRemoteLinkInfo(), branch);
    }

    public async getRemoteFileUrl(ref: string, filePath: string): Promise<string | undefined> {
        return getRemoteFileUrl(await this.getRemoteLinkInfo(), ref, filePath);
    }

    public async getRemoteCompareUrl(base: string, head: string): Promise<string | undefined> {
        return getRemoteCompareUrl(await this.getRemoteLinkInfo(), base, head);
    }

    public async getRemoteBranches(): Promise<string[]> {
        try {
            const branches = await this.options.git.branch(['-r']);
            return branches.all;
        } catch (e) {
            console.error('Error getting remote branches:', e);
            return [];
        }
    }

    public async fetch(): Promise<void> {
        await this.options.git.fetch(['--all', '--prune']);
        this.options.notifyChanged();
    }

    public async updateBranch(branch: string, force: boolean = false): Promise<'success' | 'diverged'> {
        const remotes = await this.getRemotes();
        const remote = remotes.length > 0 ? remotes[0] : 'origin';

        try {
            if (force) {
                await this.options.git.fetch([remote, `+${branch}:${branch}`]);
            } else {
                await this.options.git.fetch([remote, `${branch}:${branch}`]);
            }
            this.options.notifyChanged();
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
            const count = await this.options.git.raw(['rev-list', '--count', 'HEAD..@{u}']);
            return parseInt(count.trim(), 10);
        } catch {
            return 0;
        }
    }

    public async getBranchStatus(): Promise<{ ahead: number; behind: number }> {
        try {
            const result = await this.options.git.raw(['rev-list', '--left-right', '--count', `HEAD...@{u}`]);
            const [ahead, behind] = result.trim().split(/\s+/).map(n => parseInt(n, 10));

            return { ahead: ahead || 0, behind: behind || 0 };
        } catch {
            try {
                const aheadCount = await this.options.git.raw(['rev-list', '--count', 'HEAD', '--not', '--remotes']);
                return { ahead: parseInt(aheadCount.trim(), 10) || 0, behind: 0 };
            } catch {
                return { ahead: 0, behind: 0 };
            }
        }
    }

    public async getUnpushedCommits(): Promise<Set<string>> {
        try {
            const result = await this.options.git.raw(['rev-list', '@{u}..HEAD']);
            const hashes = result.trim().split('\n').filter(h => h.length > 0);
            return new Set(hashes);
        } catch {
            try {
                const result = await this.options.git.raw(['log', 'HEAD', '--not', '--remotes', '--format=%H']);
                const hashes = result.trim().split('\n').filter(h => h.length > 0);
                return new Set(hashes);
            } catch {
                return new Set();
            }
        }
    }

    public async getAllBranchesAheadBehind(): Promise<Map<string, { ahead: number; behind: number; upstream?: string }>> {
        const result = new Map<string, { ahead: number; behind: number; upstream?: string }>();
        try {
            const output = await this.options.git.raw([
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
        await this.options.git.checkoutLocalBranch(branchName);
        this.options.notifyChanged();
    }

    public async checkoutRemoteBranch(remoteBranch: string, force: boolean = false): Promise<void> {
        const checkout = async () => {
            const parts = remoteBranch.split('/');
            const localBranchName = parts.slice(1).join('/');

            const localBranches = await this.getBranches();
            if (localBranches.all.includes(localBranchName)) {
                if (force) {
                    await this.options.git.checkout(['-f', localBranchName]);
                } else {
                    await this.options.git.checkout(localBranchName);
                }
            } else {
                const args = ['-b', localBranchName, '--track', remoteBranch];
                if (force) {
                    args.unshift('-f');
                }
                await this.options.git.checkout(args);
            }
        };

        if (force) {
            await checkout();
            this.options.notifyChanged();
            return;
        }

        await this.options.withTemporaryStash(`checkout remote branch ${remoteBranch}`, checkout);
    }

    public async getCommitsToPush(
        localBranch: string,
        remote: string,
        remoteBranch: string,
        options: { maxCount?: number; skip?: number } = {}
    ): Promise<CommitDetails[]> {
        try {
            const hasRemoteBranch = await this.remoteBranchExists(remote, remoteBranch);

            if (hasRemoteBranch) {
                const args: string[] = ['log'];

                if (options.maxCount) {
                    args.push(`--max-count=${options.maxCount}`);
                }

                if (options.skip) {
                    args.push(`--skip=${options.skip}`);
                }

                args.push(`--format=${PUSH_COMMIT_LOG_FORMAT}`);
                args.push(`${remote}/${remoteBranch}..${localBranch}`);

                const result = await this.options.git.raw(args);

                return this.parsePushCommitLog(result);
            } else {
                return this.getCommitsNotInRemote(localBranch, options.maxCount ?? 20, options.skip);
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
            const hasRemoteBranch = await this.remoteBranchExists(remote, remoteBranch);

            if (hasRemoteBranch) {
                const count = await this.options.git.raw(['rev-list', '--count', `${remote}/${remoteBranch}..${localBranch}`]);
                return parseInt(count.trim(), 10);
            } else {
                const count = await this.options.git.raw(['rev-list', '--count', localBranch, '--not', '--remotes']);
                return parseInt(count.trim(), 10);
            }
        } catch {
            return 0;
        }
    }

    private async getCommitsNotInRemote(branch: string, maxCount: number, skip?: number): Promise<CommitDetails[]> {
        try {
            const args = [
                'log',
                branch,
                '--not',
                '--remotes',
                `--max-count=${maxCount}`,
                `--format=${PUSH_COMMIT_LOG_FORMAT}`
            ];

            if (skip) {
                args.push(`--skip=${skip}`);
            }

            const result = await this.options.git.raw(args);

            return this.parsePushCommitLog(result);
        } catch {
            return [];
        }
    }

    private parsePushCommitLog(result: string): CommitDetails[] {
        if (!result.trim()) {
            return [];
        }

        return result
            .split(GIT_LOG_RECORD_SEPARATOR)
            .map(record => record.trimEnd())
            .filter(record => record.trim())
            .map(record => {
                const [hash, shortHash, subject, authorName, date, authorEmail, parentsStr, ...bodyParts] = record.split(GIT_LOG_FIELD_SEPARATOR);
                const parentHashes = parentsStr
                    ? parentsStr.trim().split(' ').filter(Boolean)
                    : [];

                return {
                    hash,
                    shortHash,
                    subject,
                    authorName,
                    date,
                    authorEmail,
                    body: bodyParts.join(GIT_LOG_FIELD_SEPARATOR).trim(),
                    files: [],
                    stats: { additions: 0, deletions: 0 },
                    parentHashes,
                    containingBranches: [],
                    refs: [],
                    filteredAncestors: []
                };
            });
    }

    private async remoteBranchExists(remote: string, branch: string): Promise<boolean> {
        try {
            await this.options.git.revparse([`${remote}/${branch}`]);
            return true;
        } catch {
            return false;
        }
    }

    public async getRebaseStatus(): Promise<'none' | 'interactive' | 'merging'> {
        try {
            const gitDir = (await this.options.git.revparse(['--git-dir'])).trim();
            const absoluteGitDir = path.isAbsolute(gitDir)
                ? gitDir
                : path.join(this.options.gitRoot, gitDir);

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
            await this.options.git.raw(['merge', '--abort']);
            this.options.notifyChanged();
            return;
        }

        await this.options.git.rebase(['--abort']);
        this.options.notifyChanged();
    }

    public async continueRebase(message?: string): Promise<void> {
        const status = await this.getRebaseStatus();

        if (message) {
            try {
                const gitDir = await this.options.git.revparse(['--git-dir']);
                const absoluteGitDir = path.isAbsolute(gitDir.trim())
                    ? gitDir.trim()
                    : path.join(this.options.gitRoot, gitDir.trim());
                const rebaseMergeMsg = path.join(absoluteGitDir, 'rebase-merge', 'message');
                const mergeMsg = path.join(absoluteGitDir, 'MERGE_MSG');

                if (fs.existsSync(rebaseMergeMsg)) {
                    fs.writeFileSync(rebaseMergeMsg, message, 'utf8');
                } else if (fs.existsSync(mergeMsg)) {
                    fs.writeFileSync(mergeMsg, message, 'utf8');
                }
            } catch (e) {
                console.error('Failed to update rebase message:', e);
            }
        }

        const gitWithEditorBypass = this.options.createEditorGit({ GIT_EDITOR: 'true' });
        if (status === 'merging') {
            await gitWithEditorBypass.raw(['merge', '--continue']);
            this.options.notifyChanged();
            return;
        }

        await gitWithEditorBypass.rebase(['--continue']);
        this.options.notifyChanged();
    }

    public async getRebaseCommitMessage(): Promise<string> {
        try {
            const gitDir = (await this.options.git.revparse(['--git-dir'])).trim();
            const absoluteGitDir = path.isAbsolute(gitDir)
                ? gitDir
                : path.join(this.options.gitRoot, gitDir);

            logger.info('rebaseMergeMsg gitDir', absoluteGitDir);

            const rebaseMergeMsg = path.join(absoluteGitDir, 'rebase-merge', 'message');
            const rebaseApplyMsg = path.join(absoluteGitDir, 'rebase-apply', 'msg');
            const mergeMsg = path.join(absoluteGitDir, 'MERGE_MSG');

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

    public async renameBranch(oldName: string, newName: string): Promise<void> {
        await this.options.git.branch(['-m', oldName, newName]);
        this.options.notifyChanged();
    }

    public async deleteBranches(branches: string[], force: boolean = false): Promise<void> {
        const args = force ? ['-D'] : ['-d'];
        await this.options.git.branch([...args, ...branches]);
        this.options.notifyChanged();
    }

    public async getTags(): Promise<string[]> {
        const tags = await this.options.git.tags();
        return tags.all;
    }

    public async getGroupedRemoteBranches(): Promise<Record<string, string[]>> {
        const branches = await this.options.git.branch(['-r']);
        const grouped: Record<string, string[]> = {};

        branches.all.forEach(fullBranchName => {
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

    public getPushInitState = async (): Promise<PushInitState> => {
        const branches = await this.getBranches();
        const remotes = await this.getRemotes();
        const upstream = await this.getUpstreamBranch(branches.current);

        return {
            repositoryPath: this.options.gitRoot,
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

        const commitsWithFiles = await Promise.all(
            commits.map(async (commit) => {
                const files = await this.options.getCommitFiles(commit.hash);
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

    public async rebaseOnto(targetBranch: string): Promise<void> {
        await this.options.withTemporaryStash(`rebase onto ${targetBranch}`, async () => {
            await this.options.git.rebase([targetBranch]);
        });
    }

    public async merge(branchName: string): Promise<void> {
        await this.options.withTemporaryStash(`merge ${branchName}`, async () => {
            await this.options.git.merge([branchName]);
        });
    }

    public async checkoutAndRebase(branch: string, targetBranch: string): Promise<void> {
        await this.options.withTemporaryStash(`checkout ${branch} and rebase onto ${targetBranch}`, async () => {
            await this.options.git.checkout(branch);
            await this.options.git.rebase([targetBranch]);
        });
    }

    public async pullWithRebase(remote: string, branch: string): Promise<void> {
        await this.options.withTemporaryStash(`pull --rebase ${remote}/${branch}`, async () => {
            await this.options.git.raw(['pull', '--rebase', remote, branch]);
        });
    }

    public async pullWithMerge(remote: string, branch: string): Promise<void> {
        await this.options.withTemporaryStash(`pull ${remote}/${branch}`, async () => {
            await this.options.git.pull(remote, branch);
        });
    }

    public async createBranchFrom(newBranch: string, fromBranch: string): Promise<void> {
        await this.options.git.checkout(['-b', newBranch, fromBranch]);
        this.options.notifyChanged();
    }

    public async reset(mode: 'soft' | 'mixed' | 'hard', commit: string): Promise<void> {
        await this.options.git.reset([`--${mode}`, commit]);
        this.options.notifyChanged();
    }

    public async cherryPick(commit: string): Promise<void> {
        await this.options.withTemporaryStash(`cherry-pick ${commit}`, async () => {
            await this.options.git.raw(['cherry-pick', commit]);
        });
    }

    public async revert(commit: string): Promise<void> {
        await this.options.withTemporaryStash(`revert ${commit}`, async () => {
            await this.options.git.revert(commit, ['--no-edit']);
        });
    }

    public async isCommitPushed(commit: string): Promise<boolean> {
        try {
            const result = await this.options.git.branch(['-r', '--contains', commit]);
            return result.all.length > 0;
        } catch {
            return false;
        }
    }

    public async checkoutCommit(commit: string): Promise<void> {
        await this.options.withTemporaryStash(`checkout commit ${commit}`, async () => {
            await this.options.git.checkout(commit);
        });
    }
}
