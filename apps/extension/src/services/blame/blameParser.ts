export const UNCOMMITTED_HASH = '0000000000000000000000000000000000000000';

export interface BlameCommit {
    hash: string;
    shortHash: string;
    author: string;
    authorEmail: string;
    authorTime: number;
    committer: string;
    committerEmail: string;
    committerTime: number;
    summary: string;
    filename: string;
    previousHash?: string;
    previousFilename?: string;
    isUncommitted: boolean;
}

/**
 * Where a block of blamed lines came from. Git reports this per block, so one commit can own
 * lines that came from different paths, for example a merge that combines two renamed files.
 */
export interface BlameLineSource {
    hash: string;
    /** Git-root-relative path of the file in `hash`. */
    filename: string;
    previousHash?: string;
    /** Git-root-relative path of the file in `previousHash`. */
    previousFilename?: string;
}

export interface FileBlame {
    /** Commit hash per final line; index 0 is line 1. */
    lines: string[];
    /** One-based line number of each final line inside its blamed commit; same indexing as `lines`. */
    originalLines: number[];
    /** Source path details per final line; same indexing as `lines`. Lines of one block share an object. */
    sources: BlameLineSource[];
    commits: Map<string, BlameCommit>;
}

const HEADER_PATTERN = /^([0-9a-f]{40}|[0-9a-f]{64}) (\d+) (\d+)(?: (\d+))?$/;

function stripEmail(value: string): string {
    return value.replace(/^<|>$/g, '');
}

function createCommit(hash: string): BlameCommit {
    return {
        hash,
        shortHash: hash.substring(0, 7),
        author: '',
        authorEmail: '',
        authorTime: 0,
        committer: '',
        committerEmail: '',
        committerTime: 0,
        summary: '',
        filename: '',
        isUncommitted: /^0+$/.test(hash),
    };
}

/**
 * Parses `git blame --porcelain` output into per-line commit hashes and commit metadata.
 */
export function parseBlamePorcelain(output: string): FileBlame {
    const lines: string[] = [];
    const originalLines: number[] = [];
    const sources: BlameLineSource[] = [];
    const commits = new Map<string, BlameCommit>();
    // Git prints `filename`/`previous` only for the first block of a commit, unless the commit
    // touched the file under more than one path; later blocks reuse the commit's last source.
    const lastSources = new Map<string, BlameLineSource>();
    const rows = output.split('\n');
    let current: BlameCommit | undefined;
    let group: BlameLineSource | undefined;

    const finishGroup = () => {
        if (!group) {
            return;
        }
        if (group.filename) {
            lastSources.set(group.hash, group);
        } else {
            const known = lastSources.get(group.hash);
            group.filename = known?.filename ?? '';
            group.previousHash = known?.previousHash;
            group.previousFilename = known?.previousFilename;
        }
    };

    for (const rawRow of rows) {
        const row = rawRow.endsWith('\r') ? rawRow.slice(0, -1) : rawRow;
        if (row.startsWith('\t')) {
            continue;
        }

        const header = HEADER_PATTERN.exec(row);
        if (header) {
            const hash = header[1];
            const finalLine = Number(header[3]);
            current = commits.get(hash);
            if (!current) {
                current = createCommit(hash);
                commits.set(hash, current);
            }
            if (header[4] !== undefined || !group || group.hash !== hash) {
                finishGroup();
                group = { hash, filename: '' };
            }
            lines[finalLine - 1] = hash;
            originalLines[finalLine - 1] = Number(header[2]);
            sources[finalLine - 1] = group;
            continue;
        }

        if (!current) {
            continue;
        }

        const separator = row.indexOf(' ');
        const key = separator === -1 ? row : row.substring(0, separator);
        const value = separator === -1 ? '' : row.substring(separator + 1);

        switch (key) {
            case 'author':
                current.author = value;
                break;
            case 'author-mail':
                current.authorEmail = stripEmail(value);
                break;
            case 'author-time':
                current.authorTime = Number(value) * 1000;
                break;
            case 'committer':
                current.committer = value;
                break;
            case 'committer-mail':
                current.committerEmail = stripEmail(value);
                break;
            case 'committer-time':
                current.committerTime = Number(value) * 1000;
                break;
            case 'summary':
                current.summary = value;
                break;
            case 'filename': {
                const filename = unquoteGitPath(value);
                if (!current.filename) {
                    current.filename = filename;
                }
                if (group) {
                    group.filename = filename;
                }
                break;
            }
            case 'previous': {
                const previousSeparator = value.indexOf(' ');
                if (previousSeparator > 0) {
                    const previousHash = value.substring(0, previousSeparator);
                    const previousFilename = unquoteGitPath(value.substring(previousSeparator + 1));
                    if (!current.previousHash) {
                        current.previousHash = previousHash;
                        current.previousFilename = previousFilename;
                    }
                    if (group) {
                        group.previousHash = previousHash;
                        group.previousFilename = previousFilename;
                    }
                }
                break;
            }
        }
    }
    finishGroup();

    return { lines, originalLines, sources, commits };
}

/**
 * Returns where a final line (zero-based) came from, falling back to the commit-level details.
 */
export function getBlameLineSource(blame: FileBlame, line: number): BlameLineSource | undefined {
    const source = blame.sources[line];
    if (source?.filename) {
        return source;
    }
    const hash = blame.lines[line];
    const commit = hash ? blame.commits.get(hash) : undefined;
    return commit
        ? {
              hash: commit.hash,
              filename: commit.filename,
              previousHash: commit.previousHash,
              previousFilename: commit.previousFilename,
          }
        : undefined;
}

const GIT_PATH_ESCAPES: Record<string, number> = {
    a: 0x07,
    b: 0x08,
    f: 0x0c,
    n: 0x0a,
    r: 0x0d,
    t: 0x09,
    v: 0x0b,
    '"': 0x22,
    '\\': 0x5c,
};

/**
 * Decodes a path that Git C-quoted because it contains special or non-ASCII characters
 * (`core.quotePath`), for example `"src/\344\275\240.ts"`. Unquoted paths are returned as-is.
 */
export function unquoteGitPath(value: string): string {
    if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) {
        return value;
    }

    const bytes: number[] = [];
    const body = Array.from(value.slice(1, -1));
    for (let index = 0; index < body.length; index++) {
        const char = body[index];
        if (char !== '\\' || index === body.length - 1) {
            bytes.push(...Buffer.from(char, 'utf8'));
            continue;
        }

        const next = body[index + 1];
        const octal = /^[0-3][0-7]{2}/.exec(body.slice(index + 1, index + 4).join(''));
        if (octal) {
            bytes.push(parseInt(octal[0], 8));
            index += 3;
        } else if (next in GIT_PATH_ESCAPES) {
            bytes.push(GIT_PATH_ESCAPES[next]);
            index += 1;
        } else {
            bytes.push(...Buffer.from(next, 'utf8'));
            index += 1;
        }
    }
    return Buffer.from(bytes).toString('utf8');
}
