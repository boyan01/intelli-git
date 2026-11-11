import type { BlameCommit } from '../../services/blame/blameParser';

export interface BlameFormatOptions {
    dateFormat: string;
    locale: string;
    messageMaxLength: number;
    now: number;
    uncommittedAuthor: string;
    uncommittedMessage: string;
}

const TOKEN_PATTERN = /\$\{(\w+)(?:\|(\d+))?\}/g;
const DATE_TOKEN_PATTERN = /\[([^\]]*)\]|YYYY|YY|MM|M|DD|D|HH|H|mm|ss/g;
const ELLIPSIS = '\u2026';

const RELATIVE_UNITS: Array<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
    { unit: 'year', ms: 365 * 24 * 60 * 60 * 1000 },
    { unit: 'month', ms: 30 * 24 * 60 * 60 * 1000 },
    { unit: 'week', ms: 7 * 24 * 60 * 60 * 1000 },
    { unit: 'day', ms: 24 * 60 * 60 * 1000 },
    { unit: 'hour', ms: 60 * 60 * 1000 },
    { unit: 'minute', ms: 60 * 1000 },
    { unit: 'second', ms: 1000 },
];

function pad2(value: number): string {
    return String(value).padStart(2, '0');
}

export function truncate(value: string, maxLength: number): string {
    if (maxLength <= 0 || value.length <= maxLength) {
        return value;
    }
    if (maxLength === 1) {
        return ELLIPSIS;
    }
    return `${value.substring(0, maxLength - 1)}${ELLIPSIS}`;
}

function fitWidth(value: string, width: number): string {
    return truncate(value, width).padEnd(width, ' ');
}

/**
 * Formats a timestamp with tokens: YYYY, YY, MM, M, DD, D, HH, H, mm, ss. Text in [brackets] is kept literally.
 */
export function formatBlameDate(timestamp: number, format: string): string {
    const date = new Date(timestamp);
    return format.replace(DATE_TOKEN_PATTERN, (token: string, literal?: string) => {
        if (literal !== undefined) {
            return literal;
        }
        switch (token) {
            case 'YYYY':
                return String(date.getFullYear());
            case 'YY':
                return pad2(date.getFullYear() % 100);
            case 'MM':
                return pad2(date.getMonth() + 1);
            case 'M':
                return String(date.getMonth() + 1);
            case 'DD':
                return pad2(date.getDate());
            case 'D':
                return String(date.getDate());
            case 'HH':
                return pad2(date.getHours());
            case 'H':
                return String(date.getHours());
            case 'mm':
                return pad2(date.getMinutes());
            case 'ss':
                return pad2(date.getSeconds());
            default:
                return token;
        }
    });
}

export function formatRelativeTime(timestamp: number, now: number, locale: string): string {
    const diff = timestamp - now;
    const absDiff = Math.abs(diff);
    let formatter: Intl.RelativeTimeFormat;
    try {
        formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    } catch {
        formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
    }

    for (const { unit, ms } of RELATIVE_UNITS) {
        if (absDiff >= ms || unit === 'second') {
            return formatter.format(Math.trunc(diff / ms), unit);
        }
    }
    return formatter.format(0, 'second');
}

export function getBlameTokenValues(commit: BlameCommit, options: BlameFormatOptions): Record<string, string> {
    const author = commit.isUncommitted ? options.uncommittedAuthor : commit.author;
    const committer = commit.isUncommitted ? options.uncommittedAuthor : commit.committer;
    const message = commit.isUncommitted ? options.uncommittedMessage : commit.summary;
    const authorTime = commit.authorTime || options.now;
    const committerTime = commit.committerTime || authorTime;

    return {
        author,
        authorEmail: commit.isUncommitted ? '' : commit.authorEmail,
        ago: formatRelativeTime(authorTime, options.now, options.locale),
        date: formatBlameDate(authorTime, options.dateFormat),
        committer,
        committerEmail: commit.isUncommitted ? '' : commit.committerEmail,
        committerAgo: formatRelativeTime(committerTime, options.now, options.locale),
        committerDate: formatBlameDate(committerTime, options.dateFormat),
        hash: commit.isUncommitted ? '' : commit.hash,
        shortHash: commit.isUncommitted ? '' : commit.shortHash,
        message: truncate(message, options.messageMaxLength),
    };
}

/**
 * Renders a blame template such as `${author}, ${ago} • ${message}`.
 * `${token|N}` pads or truncates the value to exactly N characters. Unknown tokens are kept as-is.
 */
/**
 * Renders a template for one commit. `columnWidths` pads tokens without an explicit width so the
 * same token lines up across lines, like a table column.
 */
export function renderBlameTemplate(
    template: string,
    commit: BlameCommit,
    options: BlameFormatOptions,
    columnWidths?: ReadonlyMap<string, number>
): string {
    const values = getBlameTokenValues(commit, options);
    return template.replace(TOKEN_PATTERN, (match: string, token: string, width?: string) => {
        const value = values[token];
        if (value === undefined) {
            return match;
        }
        if (width) {
            return fitWidth(value, Number(width));
        }
        return value.padEnd(columnWidths?.get(token) ?? 0, ' ');
    });
}

/**
 * Measures the widest value of every token used by the template across the given commits.
 */
export function measureBlameColumns(
    template: string,
    commits: Iterable<BlameCommit>,
    options: BlameFormatOptions
): Map<string, number> {
    const tokens = new Set([...template.matchAll(TOKEN_PATTERN)].filter((match) => !match[2]).map((match) => match[1]));
    const widths = new Map<string, number>();
    for (const commit of commits) {
        const values = getBlameTokenValues(commit, options);
        for (const token of tokens) {
            const value = values[token];
            if (value !== undefined) {
                widths.set(token, Math.max(widths.get(token) ?? 0, value.length));
            }
        }
    }
    return widths;
}

export type BlameColumn = 'date' | 'author' | 'commit' | 'message';

const COLUMN_ORDER: BlameColumn[] = ['date', 'author', 'commit', 'message'];
const COLUMN_TOKENS: Record<BlameColumn, string[]> = {
    date: ['date', 'ago', 'committerDate', 'committerAgo'],
    author: ['author', 'authorEmail', 'committer', 'committerEmail'],
    commit: ['shortHash', 'hash'],
    message: ['message'],
};
const COLUMN_DEFAULT_TOKEN: Record<BlameColumn, string> = {
    date: 'date',
    author: 'author',
    commit: 'shortHash',
    message: 'message',
};

function getTemplateTokens(template: string): string[] {
    return [...template.matchAll(TOKEN_PATTERN)].map((match) => match[1]);
}

export function hasBlameColumn(template: string, column: BlameColumn): boolean {
    const tokens = getTemplateTokens(template);
    return COLUMN_TOKENS[column].some((token) => tokens.includes(token));
}

/**
 * Shows or hides a column in a gutter template. Templates made only of tokens and spaces are
 * rebuilt in a stable column order; custom templates keep their text and only gain or lose tokens.
 * Returns the template unchanged when hiding would leave no column.
 */
export function toggleBlameColumn(template: string, column: BlameColumn): string {
    const visible = hasBlameColumn(template, column);
    const isSimple = template.replace(TOKEN_PATTERN, '').trim() === '';

    if (isSimple) {
        const parts = [...template.matchAll(TOKEN_PATTERN)].map((match) => ({
            column: COLUMN_ORDER.find((candidate) => COLUMN_TOKENS[candidate].includes(match[1])),
            text: match[0],
        }));
        const next = visible
            ? parts.filter((part) => part.column !== column)
            : [...parts, { column, text: `\${${COLUMN_DEFAULT_TOKEN[column]}}` }];
        if (next.length === 0) {
            return template;
        }
        const rank = (part: { column?: BlameColumn }) =>
            part.column ? COLUMN_ORDER.indexOf(part.column) : COLUMN_ORDER.length;
        return next
            .map((part, index) => ({ part, index }))
            .sort((a, b) => rank(a.part) - rank(b.part) || a.index - b.index)
            .map(({ part }) => part.text)
            .join(' ');
    }

    if (!visible) {
        return `${template.trimEnd()} \${${COLUMN_DEFAULT_TOKEN[column]}}`;
    }
    const next = template
        .replace(TOKEN_PATTERN, (match: string, token: string) => (COLUMN_TOKENS[column].includes(token) ? '' : match))
        .replace(/\s{2,}/g, ' ')
        .trim();
    return getTemplateTokens(next).length > 0 ? next : template;
}
