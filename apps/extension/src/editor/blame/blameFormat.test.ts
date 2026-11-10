import { describe, expect, it } from 'vitest';
import type { BlameCommit } from '../../services/blame/blameParser';
import {
    formatBlameDate,
    formatRelativeTime,
    hasBlameColumn,
    measureBlameColumns,
    renderBlameTemplate,
    toggleBlameColumn,
    truncate,
    type BlameFormatOptions,
} from './blameFormat';

const NOW = new Date(2026, 10, 10, 12, 0, 0).getTime();

function createCommit(overrides: Partial<BlameCommit> = {}): BlameCommit {
    return {
        hash: '0123456789abcdef0123456789abcdef01234567',
        shortHash: '0123456',
        author: 'phuctt4',
        authorEmail: 'phuctt4@example.com',
        authorTime: new Date(2022, 2, 27, 9, 5, 7).getTime(),
        committer: 'lkqm',
        committerEmail: 'lkqm@example.com',
        committerTime: new Date(2025, 2, 27, 9, 5, 7).getTime(),
        summary: 'update config',
        filename: 'config.yaml',
        isUncommitted: false,
        ...overrides,
    };
}

function createOptions(overrides: Partial<BlameFormatOptions> = {}): BlameFormatOptions {
    return {
        dateFormat: 'YYYY/M/D',
        locale: 'en',
        messageMaxLength: 50,
        now: NOW,
        uncommittedAuthor: 'You',
        uncommittedMessage: 'Uncommitted changes',
        ...overrides,
    };
}

describe('renderBlameTemplate', () => {
    it('renders the default inline format', () => {
        const text = renderBlameTemplate('${author}, ${ago} \u2022 ${message}', createCommit(), createOptions());

        expect(text).toBe('phuctt4, 4 years ago \u2022 update config');
    });

    it('renders the default gutter format', () => {
        const text = renderBlameTemplate('${date} ${committer}', createCommit(), createOptions());

        expect(text).toBe('2022/3/27 lkqm');
    });

    it('renders hashes, emails and committer tokens', () => {
        const text = renderBlameTemplate(
            '${shortHash} ${hash} ${authorEmail} ${committerEmail} ${committerDate}',
            createCommit(),
            createOptions()
        );

        expect(text).toBe(
            '0123456 0123456789abcdef0123456789abcdef01234567 phuctt4@example.com lkqm@example.com 2025/3/27'
        );
    });

    it('pads and truncates tokens with a width modifier', () => {
        const options = createOptions();

        expect(renderBlameTemplate('[${author|10}]', createCommit(), options)).toBe('[phuctt4   ]');
        expect(renderBlameTemplate('[${author|4}]', createCommit(), options)).toBe('[phu\u2026]');
    });

    it('truncates the message to the configured length', () => {
        const commit = createCommit({ summary: 'a very long commit message' });

        expect(renderBlameTemplate('${message}', commit, createOptions({ messageMaxLength: 10 }))).toBe('a very lo\u2026');
        expect(renderBlameTemplate('${message}', commit, createOptions({ messageMaxLength: 0 }))).toBe(
            'a very long commit message'
        );
    });

    it('keeps unknown tokens untouched', () => {
        expect(renderBlameTemplate('${unknown} ${author}', createCommit(), createOptions())).toBe('${unknown} phuctt4');
    });

    it('uses the uncommitted labels for uncommitted lines', () => {
        const commit = createCommit({ isUncommitted: true, authorTime: NOW });

        expect(renderBlameTemplate('${author} \u2022 ${message} ${shortHash}', commit, createOptions()).trim()).toBe(
            'You \u2022 Uncommitted changes'
        );
    });
});

describe('formatBlameDate', () => {
    it('supports numeric tokens and literal text', () => {
        const timestamp = new Date(2025, 2, 7, 4, 5, 6).getTime();

        expect(formatBlameDate(timestamp, 'YYYY-MM-DD HH:mm:ss')).toBe('2025-03-07 04:05:06');
        expect(formatBlameDate(timestamp, 'YY/M/D H')).toBe('25/3/7 4');
        expect(formatBlameDate(timestamp, '[Day] D')).toBe('Day 7');
    });
});

describe('formatRelativeTime', () => {
    it('picks the largest fitting unit', () => {
        expect(formatRelativeTime(NOW - 30 * 1000, NOW, 'en')).toMatch(/second|now/);
        expect(formatRelativeTime(NOW - 3 * 60 * 60 * 1000, NOW, 'en')).toBe('3 hours ago');
        expect(formatRelativeTime(NOW - 2 * 24 * 60 * 60 * 1000, NOW, 'en')).toBe('2 days ago');
    });

    it('rounds down to whole units like other git tools', () => {
        expect(formatRelativeTime(NOW - 47 * 60 * 60 * 1000, NOW, 'en')).toBe('yesterday');
        expect(formatRelativeTime(NOW - 4.6 * 365 * 24 * 60 * 60 * 1000, NOW, 'en')).toBe('4 years ago');
    });

    it('falls back to English for invalid locales', () => {
        expect(formatRelativeTime(NOW - 3 * 60 * 60 * 1000, NOW, 'not a locale!')).toBe('3 hours ago');
    });
});

describe('truncate', () => {
    it('returns short values unchanged', () => {
        expect(truncate('abc', 5)).toBe('abc');
        expect(truncate('abcdef', 1)).toBe('\u2026');
    });
});

describe('gutter columns', () => {
    it('pads tokens to the widest value so columns line up', () => {
        const commits = [
            createCommit({ author: 'Al', authorTime: new Date(2025, 11, 27).getTime() }),
            createCommit({ author: 'phuctt4', authorTime: new Date(2024, 0, 1).getTime() }),
        ];
        const widths = measureBlameColumns('${date} ${author}', commits, createOptions());

        expect(widths.get('date')).toBe('2025/12/27'.length);
        expect(renderBlameTemplate('${date} ${author}', commits[1], createOptions(), widths)).toBe('2024/1/1   phuctt4');
        expect(renderBlameTemplate('${date} ${author}', commits[0], createOptions(), widths)).toBe('2025/12/27 Al     ');
    });

    it('keeps explicit widths over measured ones', () => {
        const widths = measureBlameColumns('${author|3}', [createCommit()], createOptions());

        expect(widths.size).toBe(0);
    });

    it('shows and hides columns in a stable order', () => {
        expect(hasBlameColumn('${date} ${author}', 'commit')).toBe(false);
        expect(toggleBlameColumn('${date} ${author}', 'commit')).toBe('${date} ${author} ${shortHash}');
        expect(toggleBlameColumn('${author} ${shortHash}', 'date')).toBe('${date} ${author} ${shortHash}');
        expect(toggleBlameColumn('${date|10} ${author}', 'date')).toBe('${author}');
        expect(toggleBlameColumn('${ago} ${author}', 'date')).toBe('${author}');
    });

    it('never hides the last column', () => {
        expect(toggleBlameColumn('${author}', 'author')).toBe('${author}');
    });

    it('keeps the text of custom templates', () => {
        expect(toggleBlameColumn('${author} (${ago})', 'commit')).toBe('${author} (${ago}) ${shortHash}');
        expect(toggleBlameColumn('${author} \u2022 ${message}', 'message')).toBe('${author} \u2022');
    });
});
