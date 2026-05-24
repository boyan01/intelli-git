import { describe, expect, it } from 'vitest';
import { applyGeneratedCommitMessage } from './commitMessageUpdate';

describe('applyGeneratedCommitMessage', () => {
    it('replaces only the subject and preserves the body', () => {
        const current = 'Old subject\n\nExisting body\nwith details';

        expect(applyGeneratedCommitMessage(current, 'New subject\n\nIgnored body', 'subject')).toBe(
            'New subject\n\nExisting body\nwith details'
        );
    });

    it('replaces only the body and preserves the subject', () => {
        const current = 'Existing subject\n\nOld body';

        expect(applyGeneratedCommitMessage(current, 'New body\nwith details', 'body')).toBe(
            'Existing subject\n\nNew body\nwith details'
        );
    });

    it('rewrites only the selected message text', () => {
        const current = 'Subject\n\nRewrite this paragraph.\nKeep this line.';
        const start = current.indexOf('Rewrite');
        const end = current.indexOf('\nKeep');

        expect(applyGeneratedCommitMessage(current, 'Improved paragraph.', 'rewrite', { start, end })).toBe(
            'Subject\n\nImproved paragraph.\nKeep this line.'
        );
    });

    it('replaces the full message only in full mode', () => {
        expect(applyGeneratedCommitMessage('Old subject\n\nOld body', 'New subject\n\nNew body', 'full')).toBe(
            'New subject\n\nNew body'
        );
    });
});
