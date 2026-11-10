import { describe, expect, it } from 'vitest';
import { getBlameLineSource, parseBlamePorcelain, UNCOMMITTED_HASH, unquoteGitPath } from './blameParser';

const HASH_A = 'a'.repeat(40);
const HASH_B = 'b'.repeat(40);

const PORCELAIN = [
    `${HASH_A} 1 1 2`,
    'author Alice',
    'author-mail <alice@example.com>',
    'author-time 1700000000',
    'author-tz +0700',
    'committer Bob',
    'committer-mail <bob@example.com>',
    'committer-time 1700000100',
    'committer-tz +0000',
    'summary Add config',
    'boundary',
    'filename src/config.ts',
    '\tconst a = 1;',
    `${HASH_A} 2 2`,
    '\tconst b = 2;',
    `${UNCOMMITTED_HASH} 3 3 1`,
    'author Not Committed Yet',
    'author-mail <not.committed.yet>',
    'author-time 1700000200',
    'author-tz +0000',
    'committer Not Committed Yet',
    'committer-mail <not.committed.yet>',
    'committer-time 1700000200',
    'committer-tz +0000',
    'summary Version of src/config.ts from src/config.ts',
    `previous ${HASH_A} src/config.ts`,
    'filename src/config.ts',
    '\tconst c = 3;',
    `${HASH_B} 3 4 1`,
    'author Carol',
    'author-mail <carol@example.com>',
    'author-time 1700000300',
    'author-tz +0000',
    'committer Carol',
    'committer-mail <carol@example.com>',
    'committer-time 1700000300',
    'committer-tz +0000',
    'summary Rename option',
    `previous ${HASH_A} src/old-config.ts`,
    'filename src/config.ts',
    '\t',
    '',
].join('\n');

describe('parseBlamePorcelain', () => {
    it('maps every final line to its commit', () => {
        const blame = parseBlamePorcelain(PORCELAIN);

        expect(blame.lines).toEqual([HASH_A, HASH_A, UNCOMMITTED_HASH, HASH_B]);
        expect(blame.originalLines).toEqual([1, 2, 3, 3]);
        expect(blame.commits.size).toBe(3);
    });

    it('records source paths per block and reuses them for repeated blocks', () => {
        const blame = parseBlamePorcelain(
            [
                `${HASH_A} 1 1 1`,
                'author Alice',
                'summary Add a and b',
                'filename a.txt',
                '\talpha',
                `${HASH_B} 1 2 1`,
                'author Bob',
                'summary Change b',
                `previous ${HASH_A} b.txt`,
                'filename b.txt',
                '\tbeta',
                `${HASH_A} 2 3 1`,
                'filename b.txt',
                '\tgamma',
                `${HASH_A} 2 4 1`,
                '\tdelta',
                `${HASH_A} 5 5 2`,
                'filename a.txt',
                '\tepsilon',
                `${HASH_A} 6 6`,
                '\tzeta',
                '',
            ].join('\n')
        );

        expect(blame.sources.map((source) => source.filename)).toEqual([
            'a.txt',
            'b.txt',
            'b.txt',
            'b.txt',
            'a.txt',
            'a.txt',
        ]);
        expect(blame.sources[1]).toMatchObject({ previousHash: HASH_A, previousFilename: 'b.txt' });
        expect(blame.commits.get(HASH_A)?.filename).toBe('a.txt');
        expect(getBlameLineSource(blame, 2)).toMatchObject({ hash: HASH_A, filename: 'b.txt' });
    });

    it('parses commit metadata once per commit', () => {
        const commit = parseBlamePorcelain(PORCELAIN).commits.get(HASH_A);

        expect(commit).toMatchObject({
            hash: HASH_A,
            shortHash: HASH_A.substring(0, 7),
            author: 'Alice',
            authorEmail: 'alice@example.com',
            authorTime: 1700000000 * 1000,
            committer: 'Bob',
            committerEmail: 'bob@example.com',
            committerTime: 1700000100 * 1000,
            summary: 'Add config',
            filename: 'src/config.ts',
            isUncommitted: false,
        });
    });

    it('keeps previous commit and path for diffs', () => {
        const commit = parseBlamePorcelain(PORCELAIN).commits.get(HASH_B);

        expect(commit?.previousHash).toBe(HASH_A);
        expect(commit?.previousFilename).toBe('src/old-config.ts');
    });

    it('flags uncommitted lines', () => {
        const commit = parseBlamePorcelain(PORCELAIN).commits.get(UNCOMMITTED_HASH);

        expect(commit?.isUncommitted).toBe(true);
    });

    it('returns an empty blame for empty output', () => {
        const blame = parseBlamePorcelain('');

        expect(blame.lines).toEqual([]);
        expect(blame.commits.size).toBe(0);
    });
});

describe('unquoteGitPath', () => {
    it('returns unquoted paths unchanged', () => {
        expect(unquoteGitPath('src/config.ts')).toBe('src/config.ts');
        expect(unquoteGitPath('src/新文件.ts')).toBe('src/新文件.ts');
    });

    it('decodes octal UTF-8 bytes and C escapes', () => {
        expect(unquoteGitPath('"src/\\346\\226\\260.ts"')).toBe('src/新.ts');
        expect(unquoteGitPath('"a\\"b\\\\c\\td.ts"')).toBe('a"b\\c\td.ts');
    });

    it('decodes quoted filename and previous fields from porcelain output', () => {
        const blame = parseBlamePorcelain(
            [
                `${HASH_A} 1 1 1`,
                'author Alice',
                'author-mail <alice@example.com>',
                'author-time 1700000000',
                'committer Alice',
                'committer-mail <alice@example.com>',
                'committer-time 1700000000',
                'summary Rename',
                `previous ${HASH_B} "\\346\\227\\247.ts"`,
                'filename "\\346\\226\\260.ts"',
                '\tline',
                '',
            ].join('\n')
        );

        expect(blame.commits.get(HASH_A)).toMatchObject({ filename: '新.ts', previousFilename: '旧.ts' });
    });
});
