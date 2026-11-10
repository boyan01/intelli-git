import * as vscode from 'vscode';
import type { BlameCommit } from '../../services/blame/blameParser';
import { BlameService, type DocumentBlame } from '../../services/blame/BlameService';
import { i18n } from '../../utils/i18n';
import { logger } from '../../utils/logger';
import {
    hasBlameColumn,
    measureBlameColumns,
    renderBlameTemplate,
    type BlameColumn,
    type BlameFormatOptions,
} from './blameFormat';
import {
    BLAME_CONFIG_SECTION,
    createBlameFormatOptions,
    createBlameHover,
    readBlameSettings,
    type BlameSettings,
} from './blameUi';

const ANNOTATED_CONTEXT_KEY = 'intelli-git.blame.activeFileAnnotated';
const MAX_ANNOTATION_WIDTH = 60;
const FULL_RENDER_LINE_LIMIT = 3000;
const VISIBLE_RANGE_BUFFER = 200;
const EDIT_DELAY_MS = 500;
const SCROLL_DELAY_MS = 50;
// Long enough for a drag or double-click to change the selection before a click counts.
const CLICK_SETTLE_MS = 250;

const HOT_COLOR: [number, number, number] = [246, 106, 10];
const COLD_COLOR: [number, number, number] = [10, 96, 246];
const HEAT_BUCKETS = 10;
const GUTTER_BACKGROUND = 'var(--vscode-editorGutter-background)';
const UNCOMMITTED_TINT = 'color-mix(in srgb, var(--vscode-editorGutter-modifiedBackground) 35%, transparent)';
const COLUMN_CONTEXT_KEYS: Record<BlameColumn, string> = {
    date: 'intelli-git.blame.gutter.showDate',
    author: 'intelli-git.blame.gutter.showAuthor',
    commit: 'intelli-git.blame.gutter.showCommit',
    message: 'intelli-git.blame.gutter.showMessage',
};

export interface BlameLineTarget {
    documentBlame: DocumentBlame;
    commit: BlameCommit;
    /** Zero-based line in the annotated document. */
    line: number;
    /** One-based line of the same text inside the blamed commit. */
    originalLine: number;
}

/**
 * Renders IntelliJ-style blame annotations in front of every line of the files the user annotates.
 */
export class GutterBlameController implements vscode.Disposable {
    private readonly decorationType: vscode.TextEditorDecorationType;
    private readonly disposables: vscode.Disposable[] = [];
    private readonly annotatedDocuments = new Set<string>();
    private readonly editorTimers = new Map<vscode.TextEditor, NodeJS.Timeout>();
    private readonly editorRequests = new Map<vscode.TextEditor, number>();
    private readonly highlightedCommits = new Map<vscode.TextEditor, string | undefined>();
    private readonly _onDidClickAnnotation = new vscode.EventEmitter<BlameLineTarget>();
    private clickTimer: NodeJS.Timeout | undefined;
    private settings: BlameSettings = readBlameSettings();

    /** Fires when the user clicks the annotation of a committed line. */
    public readonly onDidClickAnnotation = this._onDidClickAnnotation.event;

    constructor(private readonly blameService: BlameService) {
        this.decorationType = vscode.window.createTextEditorDecorationType({
            before: {
                color: new vscode.ThemeColor('editorLineNumber.foreground'),
                margin: '0 1.5em 0 0',
                fontStyle: 'normal',
                fontWeight: 'normal',
            },
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        });

        this.disposables.push(
            this.decorationType,
            this._onDidClickAnnotation,
            vscode.window.onDidChangeVisibleTextEditors(() => this.scheduleAll(0)),
            vscode.window.onDidChangeActiveTextEditor(() => this.updateContextKey()),
            vscode.window.onDidChangeTextEditorSelection((event) => {
                if (this.isAnnotated(event.textEditor.document)) {
                    this.updateHighlight(event.textEditor);
                    this.detectAnnotationClick(event);
                }
            }),
            vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
                if (
                    this.isAnnotated(event.textEditor.document) &&
                    event.textEditor.document.lineCount > FULL_RENDER_LINE_LIMIT
                ) {
                    this.scheduleEditor(event.textEditor, SCROLL_DELAY_MS);
                }
            }),
            vscode.workspace.onDidChangeTextDocument((event) => {
                if (event.contentChanges.length > 0 && this.isAnnotated(event.document)) {
                    this.scheduleDocument(event.document, EDIT_DELAY_MS);
                }
            }),
            vscode.workspace.onDidCloseTextDocument((document) => {
                if (this.annotatedDocuments.delete(document.uri.toString())) {
                    this.updateContextKey();
                }
            }),
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration(BLAME_CONFIG_SECTION)) {
                    this.settings = readBlameSettings();
                    this.updateViewContextKeys();
                    this.scheduleAll(0);
                }
            }),
            blameService.onDidInvalidate(() => this.scheduleAll(EDIT_DELAY_MS))
        );

        this.updateContextKey();
        this.updateViewContextKeys();
    }

    public isAnnotated(document: vscode.TextDocument): boolean {
        return this.annotatedDocuments.has(document.uri.toString());
    }

    /**
     * Resolves the blamed commit of a line in an annotated document.
     */
    public async getLineTarget(uri: vscode.Uri, line: number): Promise<BlameLineTarget | undefined> {
        const document = this.resolveDocument(uri);
        if (!document || !this.isAnnotated(document)) {
            return undefined;
        }
        const documentBlame = await this.blameService.getBlame(document);
        const hash = documentBlame?.blame.lines[line];
        const commit = hash ? documentBlame?.blame.commits.get(hash) : undefined;
        return documentBlame && commit
            ? { documentBlame, commit, line, originalLine: documentBlame.blame.originalLines[line] ?? line + 1 }
            : undefined;
    }

    public async toggle(uri?: vscode.Uri): Promise<void> {
        const document = this.resolveDocument(uri);
        if (!document) {
            return;
        }
        if (this.isAnnotated(document)) {
            this.close(document.uri);
        } else {
            await this.annotate(document.uri);
        }
    }

    public async annotate(uri?: vscode.Uri): Promise<void> {
        const document = this.resolveDocument(uri);
        if (!document) {
            return;
        }

        const documentBlame = BlameService.isBlameable(document)
            ? await this.blameService.getBlame(document)
            : undefined;
        if (!documentBlame) {
            void vscode.window.showInformationMessage(i18n.t('Git blame is not available for this file.'));
            return;
        }

        this.annotatedDocuments.add(document.uri.toString());
        this.updateContextKey();
        this.scheduleDocument(document, 0);
    }

    public close(uri?: vscode.Uri): void {
        const document = this.resolveDocument(uri);
        if (!document || !this.annotatedDocuments.delete(document.uri.toString())) {
            return;
        }
        this.updateContextKey();
        for (const editor of this.editorsFor(document)) {
            this.cancelEditor(editor);
            this.highlightedCommits.delete(editor);
            editor.setDecorations(this.decorationType, []);
        }
    }

    public dispose(): void {
        clearTimeout(this.clickTimer);
        this.editorTimers.forEach((timer) => clearTimeout(timer));
        this.editorTimers.clear();
        this.editorRequests.clear();
        this.highlightedCommits.clear();
        this.annotatedDocuments.clear();
        void vscode.commands.executeCommand('setContext', ANNOTATED_CONTEXT_KEY, false);
        this.disposables.forEach((disposable) => disposable.dispose());
        this.disposables.length = 0;
    }

    private resolveDocument(uri?: vscode.Uri): vscode.TextDocument | undefined {
        if (!uri) {
            return vscode.window.activeTextEditor?.document;
        }
        const key = uri.toString();
        return (
            vscode.window.visibleTextEditors.find((editor) => editor.document.uri.toString() === key)?.document ??
            vscode.workspace.textDocuments.find((document) => document.uri.toString() === key)
        );
    }

    private editorsFor(document: vscode.TextDocument): vscode.TextEditor[] {
        return vscode.window.visibleTextEditors.filter((editor) => editor.document === document);
    }

    private updateContextKey(): void {
        const document = vscode.window.activeTextEditor?.document;
        void vscode.commands.executeCommand(
            'setContext',
            ANNOTATED_CONTEXT_KEY,
            !!document && this.isAnnotated(document)
        );
    }

    private updateViewContextKeys(): void {
        for (const [column, key] of Object.entries(COLUMN_CONTEXT_KEYS) as Array<[BlameColumn, string]>) {
            void vscode.commands.executeCommand('setContext', key, hasBlameColumn(this.settings.gutterFormat, column));
        }
    }

    /**
     * Emphasizes every annotation of the commit under the cursor, like IntelliJ does. It never starts
     * git: while the buffer has moved past the last blame, the pending edit render updates the highlight.
     */
    private updateHighlight(editor: vscode.TextEditor): void {
        const last = this.blameService.getLastBlame(editor.document);
        if (!last || last.version !== editor.document.version) {
            return;
        }
        const hash = last.documentBlame.blame.lines[editor.selection.active.line];
        if (this.highlightedCommits.get(editor) !== hash) {
            this.highlightedCommits.set(editor, hash);
            this.scheduleEditor(editor, 0);
        }
    }

    /**
     * Decorations cannot receive clicks, but a click on the annotation drawn in front of a line moves
     * the cursor to column 0 of that line. Empty lines are skipped because any click on them lands
     * there too.
     */
    private detectAnnotationClick(event: vscode.TextEditorSelectionChangeEvent): void {
        clearTimeout(this.clickTimer);
        this.clickTimer = undefined;
        const { textEditor: editor, selections } = event;
        if (
            this.settings.gutterClickAction !== 'openInGitLog' ||
            event.kind !== vscode.TextEditorSelectionChangeKind.Mouse ||
            !isClickAtLineStart(editor.document, selections)
        ) {
            return;
        }

        const { document } = editor;
        const version = document.version;
        const position = selections[0].active;
        this.clickTimer = setTimeout(async () => {
            this.clickTimer = undefined;
            if (
                document.version !== version ||
                editor.selections.length !== 1 ||
                !editor.selection.isEmpty ||
                !editor.selection.active.isEqual(position)
            ) {
                return;
            }
            const target = await this.getLineTarget(document.uri, position.line);
            if (target && !target.commit.isUncommitted) {
                this._onDidClickAnnotation.fire(target);
            }
        }, CLICK_SETTLE_MS);
    }

    private scheduleAll(delay: number): void {
        for (const editor of vscode.window.visibleTextEditors) {
            if (this.isAnnotated(editor.document)) {
                this.scheduleEditor(editor, delay);
            }
        }
        for (const editor of [...this.editorTimers.keys()]) {
            if (!vscode.window.visibleTextEditors.includes(editor)) {
                this.cancelEditor(editor);
            }
        }
        for (const editor of [...this.highlightedCommits.keys()]) {
            if (!vscode.window.visibleTextEditors.includes(editor)) {
                this.highlightedCommits.delete(editor);
            }
        }
    }

    private scheduleDocument(document: vscode.TextDocument, delay: number): void {
        for (const editor of this.editorsFor(document)) {
            this.scheduleEditor(editor, delay);
        }
    }

    private scheduleEditor(editor: vscode.TextEditor, delay: number): void {
        this.cancelEditor(editor);
        this.editorTimers.set(
            editor,
            setTimeout(() => {
                this.editorTimers.delete(editor);
                void this.render(editor);
            }, delay)
        );
    }

    private cancelEditor(editor: vscode.TextEditor): void {
        const timer = this.editorTimers.get(editor);
        if (timer) {
            clearTimeout(timer);
            this.editorTimers.delete(editor);
        }
        this.editorRequests.set(editor, (this.editorRequests.get(editor) ?? 0) + 1);
    }

    private async render(editor: vscode.TextEditor): Promise<void> {
        const requestId = (this.editorRequests.get(editor) ?? 0) + 1;
        this.editorRequests.set(editor, requestId);
        const isCurrent = () =>
            this.editorRequests.get(editor) === requestId &&
            this.isAnnotated(editor.document) &&
            vscode.window.visibleTextEditors.includes(editor);

        try {
            const { document } = editor;
            const version = document.version;
            const documentBlame = await this.blameService.getBlame(document);
            if (!isCurrent() || document.version !== version) {
                return;
            }
            if (!documentBlame) {
                editor.setDecorations(this.decorationType, []);
                return;
            }

            const decorations = await this.buildDecorations(editor, documentBlame);
            if (isCurrent() && document.version === version) {
                editor.setDecorations(this.decorationType, decorations);
            }
        } catch (error) {
            logger.debug(
                `Failed to render blame annotations: ${error instanceof Error ? error.message : String(error)}`
            );
        } finally {
            if (this.editorRequests.get(editor) === requestId && !vscode.window.visibleTextEditors.includes(editor)) {
                this.editorRequests.delete(editor);
            }
        }
    }

    private async buildDecorations(
        editor: vscode.TextEditor,
        documentBlame: DocumentBlame
    ): Promise<vscode.DecorationOptions[]> {
        const { blame } = documentBlame;
        const options = createBlameFormatOptions(this.settings);

        const columnWidths = measureBlameColumns(this.settings.gutterFormat, blame.commits.values(), options);
        const texts = new Map<string, string>();
        let width = 0;
        for (const [hash, commit] of blame.commits) {
            const text = toAnnotationText(
                renderBlameTemplate(this.settings.gutterFormat, commit, options, columnWidths)
            );
            texts.set(hash, text);
            width = Math.max(width, text.length);
        }
        width = Math.max(1, Math.min(width, MAX_ANNOTATION_WIDTH));

        const lines = getLinesToRender(editor);
        const commitsInRange = new Set<string>();
        for (const line of lines) {
            const hash = blame.lines[line];
            if (hash) {
                commitsInRange.add(hash);
            }
        }

        const hovers = await this.buildHovers(documentBlame, commitsInRange, options);
        const tints =
            this.settings.gutterColorBy === 'age'
                ? createHeatColors(blame.commits)
                : this.settings.gutterColorBy === 'author'
                  ? createAuthorColors(blame.commits)
                  : undefined;
        const highlightedHash = blame.lines[editor.selection.active.line];
        this.highlightedCommits.set(editor, highlightedHash);

        const decorations: vscode.DecorationOptions[] = [];
        for (const line of lines) {
            const hash = blame.lines[line];
            const commit = hash ? blame.commits.get(hash) : undefined;
            const text = commit ? (texts.get(commit.hash) ?? '') : '';
            const tint =
                commit && tints ? (commit.isUncommitted ? UNCOMMITTED_TINT : tints.get(commit.hash)) : undefined;
            const highlighted = !!commit && commit.hash === highlightedHash;
            decorations.push({
                range: new vscode.Range(line, 0, line, 0),
                hoverMessage: commit ? hovers.get(commit.hash) : undefined,
                renderOptions: {
                    before: {
                        contentText: (text.length > width ? text.slice(0, width - 1) + '\u2026' : text) || '\u00a0',
                        color: highlighted ? new vscode.ThemeColor('editorLineNumber.activeForeground') : undefined,
                        fontWeight: highlighted ? 'bold' : undefined,
                        textDecoration: createCellStyle(width, tint, highlighted),
                    },
                },
            });
        }
        return decorations;
    }

    private async buildHovers(
        documentBlame: DocumentBlame,
        hashes: Set<string>,
        options: BlameFormatOptions
    ): Promise<Map<string, vscode.MarkdownString>> {
        const hovers = new Map<string, vscode.MarkdownString>();
        if (!this.settings.gutterHoverEnabled) {
            return hovers;
        }

        const committed = [...hashes].filter((hash) => !documentBlame.blame.commits.get(hash)?.isUncommitted);
        const messages = await this.blameService.getCommitMessages(documentBlame.service, committed);
        for (const hash of hashes) {
            const commit = documentBlame.blame.commits.get(hash);
            if (commit) {
                hovers.set(
                    hash,
                    createBlameHover(commit, { repoPath: documentBlame.repoPath, message: messages.get(hash), options })
                );
            }
        }
        return hovers;
    }
}

/**
 * Styles the injected text as a fixed-width, gutter-colored column. VS Code has no API for text in
 * the real gutter, so the cell is drawn in front of the code and tinted like IntelliJ annotations.
 */
function createCellStyle(width: number, tint: string | undefined, highlighted: boolean): string {
    const background = tint ? `linear-gradient(${tint}, ${tint}), ${GUTTER_BACKGROUND}` : GUTTER_BACKGROUND;
    return [
        'none',
        'display: inline-block',
        'vertical-align: top',
        'box-sizing: content-box',
        `width: ${width}ch`,
        'padding: 0 1ch',
        'font-size: 90%',
        `background: ${background}`,
        `box-shadow: inset 2px 0 ${highlighted ? 'var(--vscode-focusBorder)' : 'transparent'}`,
        'overflow: hidden',
        'white-space: pre',
    ].join('; ');
}

export function isClickAtLineStart(
    document: Pick<vscode.TextDocument, 'lineAt'>,
    selections: readonly vscode.Selection[]
): boolean {
    if (selections.length !== 1) {
        return false;
    }
    const [selection] = selections;
    return (
        selection.isEmpty && selection.active.character === 0 && document.lineAt(selection.active.line).text.length > 0
    );
}

function toAnnotationText(value: string): string {
    return value
        .replace(/[\r\n\t]+/g, ' ')
        .trimEnd()
        .replace(/ /g, '\u00a0');
}

function getLinesToRender(editor: vscode.TextEditor): number[] {
    const lineCount = editor.document.lineCount;
    if (lineCount <= FULL_RENDER_LINE_LIMIT) {
        return Array.from({ length: lineCount }, (_, index) => index);
    }

    const lines = new Set<number>();
    for (const range of editor.visibleRanges) {
        const start = Math.max(0, range.start.line - VISIBLE_RANGE_BUFFER);
        const end = Math.min(lineCount - 1, range.end.line + VISIBLE_RANGE_BUFFER);
        for (let line = start; line <= end; line++) {
            lines.add(line);
        }
    }
    return [...lines].sort((a, b) => a - b);
}

/**
 * Maps each commit to a hot-to-cold background tint by its age relative to the other commits in the file.
 */
export function createHeatColors(commits: Map<string, BlameCommit>): Map<string, string> {
    const committed = [...commits.values()].filter((commit) => !commit.isUncommitted);
    const colors = new Map<string, string>();
    if (committed.length === 0) {
        return colors;
    }

    const times = committed.map((commit) => commit.authorTime);
    const newest = Math.max(...times);
    const oldest = Math.min(...times);
    const span = Math.log1p(Math.max(0, newest - oldest));
    for (const commit of committed) {
        const age = span > 0 ? Math.log1p(newest - commit.authorTime) / span : 0;
        const bucket = Math.min(HEAT_BUCKETS - 1, Math.floor(age * HEAT_BUCKETS));
        const ratio = bucket / (HEAT_BUCKETS - 1);
        const [r, g, b] = HOT_COLOR.map((hot, index) => Math.round(hot + (COLD_COLOR[index] - hot) * ratio));
        const alpha = (0.32 - ratio * 0.22).toFixed(2);
        colors.set(commit.hash, `rgba(${r}, ${g}, ${b}, ${alpha})`);
    }
    return colors;
}

/**
 * Gives every author a stable background tint so lines by the same person group visually.
 */
export function createAuthorColors(commits: Map<string, BlameCommit>): Map<string, string> {
    const colors = new Map<string, string>();
    for (const commit of commits.values()) {
        if (commit.isUncommitted) {
            continue;
        }
        const key = (commit.authorEmail || commit.author).toLowerCase();
        let hash = 0;
        for (let index = 0; index < key.length; index++) {
            hash = (hash * 31 + key.charCodeAt(index)) | 0;
        }
        const hue = Math.abs(hash) % 360;
        colors.set(commit.hash, `hsla(${hue}, 65%, 50%, 0.28)`);
    }
    return colors;
}
