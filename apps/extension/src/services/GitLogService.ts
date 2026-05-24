import type { SimpleGit } from 'simple-git';
import type { CommitDetails, CommitFile, GitStatusCode, LogCommit, LogOptions, RefInfo } from '@shared/messages';
import { logger } from '../utils/logger';

interface GitLogServiceOptions {
    toRepoPath(filePath: string): string;
    toWorkspacePath(repoPath: string): string | null;
    getWorkspaceRoot(): string;
}

interface CachedValue<T> {
    key: string;
    value?: T;
    promise?: Promise<T>;
}

/**
 * Owns read-only Git history behavior: log loading, commit details, authors,
 * graph ancestry stitching, and ref parsing.
 */
export class GitLogService {
    private graphCache: CachedValue<Map<string, string[]>> | null = null;
    private authorsCache: CachedValue<string[]> | null = null;

    constructor(
        private readonly git: SimpleGit,
        private readonly options: GitLogServiceOptions
    ) { }

    public getCommitFiles = async (hash: string): Promise<CommitFile[]> => {
        try {
            const result = await this.git.show([hash, '--name-status', '--pretty=format:']);
            const lines = result.split('\n').filter(l => l.trim());
            return lines.map(line => {
                const [status, ...pathParts] = line.split('\t');
                const repoPath = pathParts.join('\t');
                const wsPath = this.options.toWorkspacePath(repoPath);
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
                // Ignore individual commit lookup errors and keep the aggregated list usable.
            }
        }
        return Array.from(fileMap.values());
    };

    public getLog = async (options: LogOptions): Promise<LogCommit[]> => {
        try {
            const args = ['log', '--date=iso'];

            const format = '%H%x00%h%x00%s%x00%an%x00%ae%x00%aI%x00%P%x00%D';
            args.push(`--format=${format}`);

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
                args.push('-n', '1', searchAsHash);
            } else {
                if (options.maxCount) {
                    args.push('-n', options.maxCount.toString());
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

            if (!searchAsHash) {
                if (options.branch) {
                    if (options.branch === 'all') {
                        args.push('--exclude=refs/stash', '--all');
                    } else if (options.branch === 'HEAD') {
                        // Default behavior already uses HEAD ancestry.
                    } else if (options.branch.includes(',')) {
                        const branches = options.branch.split(',').map(b => b.trim()).filter(Boolean);
                        args.push(...branches);
                    } else {
                        args.push(options.branch);
                    }
                } else {
                    args.push('--exclude=refs/stash', '--all');
                }
            }

            if (options.since) {
                args.push(`--since=${options.since}`);
            }
            if (options.until) {
                args.push(`--until=${options.until}`);
            }

            args.push('--author-date-order');

            if (options.paths && options.paths.length > 0) {
                args.push('--', ...options.paths.map(p => this.options.toRepoPath(p)));
            } else if (options.fileFilter) {
                args.push('--', this.options.toRepoPath(options.fileFilter));
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
                        refs: this.parseRefs(refsStr),
                        body: '',
                        files: [],
                        stats: { additions: 0, deletions: 0 },
                        containingBranches: [],
                        filteredAncestors: []
                    };
                });

            const isFilteredMode = !!options.search || (options.branch && options.branch !== 'all' && options.branch !== 'HEAD');
            if (isFilteredMode && commits.length > 1) {
                await this.ensureGraphLoaded();

                const remainingVisibleHashes = new Set(commits.map(commit => commit.hash));

                for (let i = 0; i < commits.length; i++) {
                    const commit = commits[i];
                    remainingVisibleHashes.delete(commit.hash);
                    const hasVisibleParent = commit.parentHashes.some(parentHash => remainingVisibleHashes.has(parentHash));

                    if (!hasVisibleParent) {
                        const visibleAncestor = this.findNearestVisibleAncestor(
                            commit.hash,
                            remainingVisibleHashes
                        );

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
    };

    public getAuthors = async (): Promise<string[]> => {
        if (!this.options.getWorkspaceRoot()) return [];

        try {
            const cacheKey = await this.getRefsSnapshotKey();
            if (this.authorsCache?.key === cacheKey) {
                if (this.authorsCache.value) return this.authorsCache.value;
                if (this.authorsCache.promise) return this.authorsCache.promise;
            }

            const promise = this.loadAuthors(cacheKey);
            this.authorsCache = { key: cacheKey, promise };
            return await promise;
        } catch (e) {
            console.error('getAuthors error:', e);
            return [];
        }
    };

    public getCurrentUser = async (): Promise<string> => {
        try {
            const result = await this.git.raw(['config', 'user.name']);
            return result ? result.trim() : '';
        } catch (e) {
            console.error('getCurrentUser error:', e);
            return '';
        }
    };

    public invalidateGraphCache(): void {
        this.graphCache = null;
        this.authorsCache = null;
    }

    public getCommitDetails = async (hash: string): Promise<CommitDetails> => {
        try {
            const showMsg = await this.git.show([hash, '--format=%B%x00%P%x00%an%x00%ae%x00%aI%x00%h%x00%D', '--no-patch']);
            const [fullMessage, parentsStr, authorName, authorEmail, date, shortHash, refsStr] = showMsg.split('\0');

            const files = await this.getCommitFiles(hash);

            let containingBranches: string[] = [];
            try {
                const branchOutput = await this.git.branch(['--contains', hash]);
                containingBranches = branchOutput.all;
            } catch {
                // Ignore error if commit is not reachable.
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
                refs: this.parseRefs(refsStr?.trim() || ''),
                filteredAncestors: []
            };
        } catch (e) {
            console.error('getCommitDetails error:', e);
            throw e;
        }
    };

    private async loadAuthors(cacheKey: string): Promise<string[]> {
        let authors: string[] = [];
        try {
            const logResult = await this.git.raw(['log', '--format=%aN']);
            authors = logResult
                ? Array.from(new Set(logResult.split('\n').map(author => author.trim()).filter(author => !!author))).sort()
                : [];
        } catch (e) {
            console.error('Failed to load authors:', e);
        }

        if (this.authorsCache?.key === cacheKey) {
            this.authorsCache = { key: cacheKey, value: authors };
        }

        return authors;
    }

    private async ensureGraphLoaded(): Promise<Map<string, string[]>> {
        const cacheKey = await this.getRefsSnapshotKey();
        if (this.graphCache?.key === cacheKey) {
            if (this.graphCache.value) return this.graphCache.value;
            if (this.graphCache.promise) return this.graphCache.promise;
        }

        const promise = this.loadGraph(cacheKey);
        this.graphCache = { key: cacheKey, promise };
        return await promise;
    }

    private async loadGraph(cacheKey: string): Promise<Map<string, string[]>> {
        const graph = new Map<string, string[]>();

        try {
            const result = await this.git.raw(['rev-list', '--exclude=refs/stash', '--all', '--parents']);

            result.split('\n').forEach(line => {
                if (!line) return;
                const parts = line.split(' ');
                const hash = parts[0];
                const parents = parts.slice(1);
                graph.set(hash, parents);
            });
        } catch (e) {
            console.error('Failed to load commit graph:', e);
        }

        if (this.graphCache?.key === cacheKey) {
            this.graphCache = { key: cacheKey, value: graph };
        }
        return graph;
    }

    private async getRefsSnapshotKey(): Promise<string> {
        const [head, refs] = await Promise.all([
            this.git.raw(['rev-parse', '--verify', 'HEAD']).catch(() => ''),
            this.git.raw([
                'for-each-ref',
                '--format=%(refname)%00%(objectname)',
                'refs/heads',
                'refs/remotes',
                'refs/tags'
            ]).catch(() => '')
        ]);

        return [
            this.options.getWorkspaceRoot(),
            head.trim(),
            refs.trim()
        ].join('\0');
    }

    private findNearestVisibleAncestor(
        startHash: string,
        visibleHashes: Set<string>
    ): string | null {
        const graph = this.graphCache?.value;
        if (!graph) return null;

        const queue: string[] = [...(graph.get(startHash) || [])];
        const visited = new Set<string>();

        let iterations = 0;
        const maxSearchDepth = 5000;

        while (queue.length > 0) {
            iterations++;
            if (iterations > maxSearchDepth) break;

            const current = queue.shift()!;
            if (visited.has(current)) continue;
            visited.add(current);

            if (visibleHashes.has(current)) {
                return current;
            }

            const parents = graph.get(current);
            if (parents) {
                for (const parent of parents) {
                    if (!visited.has(parent)) {
                        queue.push(parent);
                    }
                }
            }
        }

        return null;
    }

    private parseRefs(refsStr: string): RefInfo[] {
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
