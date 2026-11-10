import * as vscode from 'vscode';
import type { BlameCommit } from '../../services/blame/blameParser';
import { i18n } from '../../utils/i18n';
import { formatBlameDate, formatRelativeTime, type BlameFormatOptions } from './blameFormat';

export const BLAME_CONFIG_SECTION = 'intelli-git.blame';

export const DEFAULT_INLINE_FORMAT = '${author}, ${ago} \u2022 ${message}';
export const DEFAULT_GUTTER_FORMAT = '${date} ${author}';
export const DEFAULT_DATE_FORMAT = 'YYYY/M/D';
export const DEFAULT_MESSAGE_MAX_LENGTH = 50;

export interface BlameSettings {
    inlineEnabled: boolean;
    inlineFormat: string;
    inlineHoverEnabled: boolean;
    gutterFormat: string;
    gutterHoverEnabled: boolean;
    gutterColorBy: BlameGutterColorBy;
    gutterClickAction: BlameGutterClickAction;
    dateFormat: string;
    messageMaxLength: number;
}

export interface BlameCommandArgs {
    repoPath: string;
    hash: string;
    /** Git-root-relative path of the file in `hash`. */
    filePath?: string;
    previousHash?: string;
    /** Git-root-relative path of the file in `previousHash`. */
    previousFilePath?: string;
}

export type BlameGutterColorBy = 'age' | 'author' | 'none';
export type BlameGutterClickAction = 'openInGitLog' | 'none';

function toColorBy(value: string | undefined): BlameGutterColorBy {
    return value === 'author' || value === 'none' ? value : 'age';
}

export function readBlameSettings(): BlameSettings {
    const config = vscode.workspace.getConfiguration(BLAME_CONFIG_SECTION);
    return {
        inlineEnabled: config.get<boolean>('inline.enabled', true),
        inlineFormat: config.get<string>('inline.format', DEFAULT_INLINE_FORMAT) || DEFAULT_INLINE_FORMAT,
        inlineHoverEnabled: config.get<boolean>('inline.hover.enabled', false),
        gutterFormat: config.get<string>('gutter.format', DEFAULT_GUTTER_FORMAT) || DEFAULT_GUTTER_FORMAT,
        gutterHoverEnabled: config.get<boolean>('gutter.hover.enabled', true),
        gutterColorBy: toColorBy(config.get<string>('gutter.colorBy', 'age')),
        gutterClickAction: config.get<string>('gutter.clickAction', 'openInGitLog') === 'none' ? 'none' : 'openInGitLog',
        dateFormat: config.get<string>('dateFormat', DEFAULT_DATE_FORMAT) || DEFAULT_DATE_FORMAT,
        messageMaxLength: Math.max(0, config.get<number>('messageMaxLength', DEFAULT_MESSAGE_MAX_LENGTH)),
    };
}

export function createBlameFormatOptions(settings: BlameSettings): BlameFormatOptions {
    return {
        dateFormat: settings.dateFormat,
        locale: vscode.env.language || 'en',
        messageMaxLength: settings.messageMaxLength,
        now: Date.now(),
        uncommittedAuthor: i18n.t('You'),
        uncommittedMessage: i18n.t('Uncommitted changes'),
    };
}

function escapeMarkdown(value: string): string {
    return value.replace(/[\\`*_{}[\]()#+\-.!<>|~]/g, '\\$&');
}

function createCommandUri(command: string, args: unknown): string {
    return `command:${command}?${encodeURIComponent(JSON.stringify([args]))}`;
}

/**
 * Builds the commit hover shared by the inline blame and the gutter annotations.
 */
export function createBlameHover(
    commit: BlameCommit,
    context: { repoPath: string; message?: string; options: BlameFormatOptions }
): vscode.MarkdownString {
    const markdown = new vscode.MarkdownString(undefined, true);
    markdown.isTrusted = {
        enabledCommands: ['intelli-git.blame.openCommitInLog', 'intelli-git.blame.showCommitDiff', 'intelli-git.copyCommitHash'],
    };

    if (commit.isUncommitted) {
        markdown.appendMarkdown(
            `$(account) **${escapeMarkdown(context.options.uncommittedAuthor)}** \u2022 ${escapeMarkdown(context.options.uncommittedMessage)}`
        );
        return markdown;
    }

    const ago = formatRelativeTime(commit.authorTime, context.options.now, context.options.locale);
    const date = formatBlameDate(commit.authorTime, 'YYYY-MM-DD HH:mm');
    const email = commit.authorEmail ? ` \\<${escapeMarkdown(commit.authorEmail)}\\>` : '';
    markdown.appendMarkdown(`$(account) **${escapeMarkdown(commit.author)}**${email}, ${escapeMarkdown(ago)} (${date})\n\n`);

    const message = (context.message || commit.summary).trim();
    if (message) {
        markdown.appendMarkdown(`${escapeMarkdown(message).replace(/\r?\n/g, '  \n')}\n\n`);
    }

    const args: BlameCommandArgs = {
        repoPath: context.repoPath,
        hash: commit.hash,
        filePath: commit.filename,
        previousHash: commit.previousHash,
        previousFilePath: commit.previousFilename,
    };
    markdown.appendMarkdown('---\n\n');
    markdown.appendMarkdown(
        [
            `[$(git-commit) ${commit.shortHash}](${createCommandUri('intelli-git.blame.openCommitInLog', args)} "${i18n.t('Open in Git Log')}")`,
            `[$(history) ${i18n.t('Open in Git Log')}](${createCommandUri('intelli-git.blame.openCommitInLog', args)})`,
            `[$(diff) ${i18n.t('Show Diff')}](${createCommandUri('intelli-git.blame.showCommitDiff', args)})`,
            `[$(copy) ${i18n.t('Copy Hash')}](${createCommandUri('intelli-git.copyCommitHash', { hash: commit.hash })})`,
        ].join('&nbsp;&nbsp;|&nbsp;&nbsp;')
    );
    return markdown;
}
