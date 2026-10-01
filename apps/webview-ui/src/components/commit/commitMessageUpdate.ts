import type { CommitMessageGenerationMode } from '@shared/messages';

export interface CommitMessageSelection {
    start: number;
    end: number;
}

function firstGeneratedLine(message: string): string {
    return message.trim().split(/\r?\n/)[0]?.trim() || '';
}

function replaceSubject(currentMessage: string, generatedMessage: string): string {
    const subject = firstGeneratedLine(generatedMessage);
    if (!subject) {
        return currentMessage;
    }

    const newlineIndex = currentMessage.indexOf('\n');
    if (newlineIndex === -1) {
        return subject;
    }

    return `${subject}${currentMessage.slice(newlineIndex)}`;
}

function replaceBody(currentMessage: string, generatedMessage: string): string {
    const body = generatedMessage.trim();
    if (!body) {
        return currentMessage;
    }

    const newlineIndex = currentMessage.indexOf('\n');
    const subject = (newlineIndex === -1 ? currentMessage : currentMessage.slice(0, newlineIndex)).trimEnd();
    if (!subject) {
        return body;
    }

    return `${subject}\n\n${body}`;
}

function replaceSelection(
    currentMessage: string,
    generatedMessage: string,
    selection?: CommitMessageSelection
): string {
    const replacement = generatedMessage.trim();
    if (!replacement || !selection || selection.start === selection.end) {
        return currentMessage;
    }

    const start = Math.max(0, Math.min(selection.start, currentMessage.length));
    const end = Math.max(start, Math.min(selection.end, currentMessage.length));
    return `${currentMessage.slice(0, start)}${replacement}${currentMessage.slice(end)}`;
}

export function applyGeneratedCommitMessage(
    currentMessage: string,
    generatedMessage: string,
    mode: CommitMessageGenerationMode,
    selection?: CommitMessageSelection
): string {
    switch (mode) {
        case 'subject':
            return replaceSubject(currentMessage, generatedMessage);
        case 'body':
            return replaceBody(currentMessage, generatedMessage);
        case 'rewrite':
            return replaceSelection(currentMessage, generatedMessage, selection);
        case 'full':
        default:
            return generatedMessage.trim();
    }
}
