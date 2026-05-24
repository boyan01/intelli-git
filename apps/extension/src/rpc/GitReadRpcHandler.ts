import type {
    BranchInfo,
    BranchListData,
    CommitDetails,
    CommitFile,
    GitLogRevealRequest,
    LogCommit,
    LogOptions,
    PushCommitsData,
    PushInitState
} from '@shared/messages';
import type { RepositoryManager } from '../services/RepositoryManager';

export class GitReadRpcHandler {
    constructor(
        private readonly repositoryManager: RepositoryManager,
        private readonly consumePendingGitLogReveal?: () => GitLogRevealRequest | undefined
    ) { }

    getPushInitState = async (): Promise<PushInitState> => {
        return this.repositoryManager.getActiveService()?.branchRemote.getPushInitState() ?? {
            localBranch: '',
            remotes: []
        };
    };

    getRemoteBranches = async (remote: string): Promise<string[]> => {
        return await this.repositoryManager.getActiveService()?.branchRemote.getRemoteBranchesForRemote(remote) ?? [];
    };

    getPushCommits = async (params: { remote: string; branch: string; limit?: number; skip?: number }): Promise<PushCommitsData> => {
        return await this.repositoryManager.getActiveService()?.branchRemote.getPushCommits(params) ?? {
            commits: [],
            hasMore: false,
            totalCount: 0
        };
    };

    getCommitFiles = async (hash: string): Promise<CommitFile[]> => {
        return await this.repositoryManager.getActiveService()?.log.getCommitFiles(hash) ?? [];
    };

    getMultiCommitFiles = async (hashes: string[]): Promise<CommitFile[]> => {
        return await this.repositoryManager.getActiveService()?.log.getMultiCommitFiles(hashes) ?? [];
    };

    getBranchInfo = async (): Promise<BranchInfo> => {
        const activeScope = this.repositoryManager.getActiveScope();
        const branchInfo = await this.repositoryManager.getActiveService()?.branchRemote.getRpcBranchInfo() ?? {
            current: '',
            all: [],
            rebaseStatus: 'none'
        };

        return {
            ...branchInfo,
            current: branchInfo.current || (activeScope?.isDetached && activeScope.head ? activeScope.head.substring(0, 7) : branchInfo.current),
            repositoryKind: activeScope?.kind,
            repositoryDetached: activeScope?.isDetached,
            repositoryPath: activeScope?.path
        };
    };

    getStashList = async () => {
        return await this.repositoryManager.getActiveService()?.getStashList() ?? [];
    };

    getStashFiles = async (index: number): Promise<CommitFile[]> => {
        return await this.repositoryManager.getActiveService()?.getStashFilesAsCommitFiles(index) ?? [];
    };

    getBranchListData = async (): Promise<BranchListData> => {
        const gitService = this.repositoryManager.getActiveService();
        if (!gitService) {
            return {
                hasRepository: false,
                currentBranch: '',
                localBranches: [],
                localBranchesInfo: [],
                remoteBranches: {},
                tags: []
            };
        }

        const data = await gitService.branchRemote.getBranchListData();
        return {
            ...data,
            hasRepository: true
        };
    };

    getLog = async (options: LogOptions): Promise<LogCommit[]> => {
        return await this.repositoryManager.getActiveService()?.log.getLog(options) ?? [];
    };

    getCommitDetails = async (hash: string): Promise<CommitDetails> => {
        return await this.repositoryManager.getActiveService()?.log.getCommitDetails(hash) ?? {
            hash,
            shortHash: hash.substring(0, 7),
            subject: '',
            authorName: '',
            authorEmail: '',
            date: '',
            body: '',
            files: [],
            stats: { additions: 0, deletions: 0 },
            parentHashes: [],
            containingBranches: [],
            refs: [],
            filteredAncestors: []
        };
    };

    getPendingGitLogReveal = async (): Promise<GitLogRevealRequest | undefined> => {
        return this.consumePendingGitLogReveal?.();
    };

    getAuthors = async (): Promise<string[]> => {
        return await this.repositoryManager.getActiveService()?.log.getAuthors() ?? [];
    };

    getCurrentUser = async (): Promise<string> => {
        return await this.repositoryManager.getActiveService()?.log.getCurrentUser() ?? '';
    };

    getWorkspaceRoot = async (): Promise<string> => {
        return this.repositoryManager.getActiveService()?.getWorkspaceRoot() ?? '';
    };

    getLastCommitInfo = async () => {
        return await this.repositoryManager.getActiveService()?.getLastCommitInfo() ?? null;
    };

    getUnpushedCommits = async (): Promise<string[]> => {
        const gitService = this.repositoryManager.getActiveService();
        if (!gitService) {
            return [];
        }

        const unpushed = await gitService.branchRemote.getUnpushedCommits();
        return Array.from(unpushed);
    };
}
