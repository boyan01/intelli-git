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

export interface FileBlame {
    /** Commit hash per final line; index 0 is line 1. */
    lines: string[];
    /** One-based line number of each final line inside its blamed commit; same indexing as `lines`. */
    originalLines: number[];
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
    const commits = new Map<string, BlameCommit>();
    const rows = output.split('\n');
    let current: BlameCommit | undefined;

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
            lines[finalLine - 1] = hash;
            originalLines[finalLine - 1] = Number(header[2]);
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
            case 'filename':
                if (!current.filename) {
                    current.filename = value;
                }
                break;
            case 'previous': {
                const previousSeparator = value.indexOf(' ');
                if (previousSeparator > 0 && !current.previousHash) {
                    current.previousHash = value.substring(0, previousSeparator);
                    current.previousFilename = value.substring(previousSeparator + 1);
                }
                break;
            }
        }
    }

    return { lines, originalLines, commits };
}
