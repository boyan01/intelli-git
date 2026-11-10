import * as vscode from 'vscode';
import { BlameService } from '../../services/blame/BlameService';
import { logger } from '../../utils/logger';
import { renderBlameTemplate } from './blameFormat';
import {
    BLAME_CONFIG_SECTION,
    createBlameFormatOptions,
    createBlameHover,
    readBlameSettings,
    type BlameSettings,
} from './blameUi';

const SELECTION_DELAY_MS = 100;
const EDIT_DELAY_MS = 500;

/**
 * Shows blame information for the current line at the end of the line, GitLens style.
 */
export class InlineBlameController implements vscode.Disposable {
    private readonly decorationType: vscode.TextEditorDecorationType;
    private readonly disposables: vscode.Disposable[] = [];
    private settings: BlameSettings = readBlameSettings();
    private updateTimer?: NodeJS.Timeout;
    private requestId = 0;
    private decoratedEditor?: vscode.TextEditor;

    constructor(private readonly blameService: BlameService) {
        this.decorationType = vscode.window.createTextEditorDecorationType({
            after: {
                margin: '0 0 0 3em',
                color: new vscode.ThemeColor('editorCodeLens.foreground'),
                fontStyle: 'italic',
                fontWeight: 'normal',
            },
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
        });

        this.disposables.push(
            this.decorationType,
            vscode.window.onDidChangeActiveTextEditor(() => {
                this.clear();
                this.scheduleUpdate(SELECTION_DELAY_MS);
            }),
            vscode.window.onDidChangeTextEditorSelection((event) => {
                if (event.textEditor === vscode.window.activeTextEditor) {
                    this.scheduleUpdate(SELECTION_DELAY_MS);
                }
            }),
            vscode.workspace.onDidChangeTextDocument((event) => {
                if (event.contentChanges.length > 0 && event.document === vscode.window.activeTextEditor?.document) {
                    this.clear();
                    this.scheduleUpdate(EDIT_DELAY_MS);
                }
            }),
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration(BLAME_CONFIG_SECTION)) {
                    this.settings = readBlameSettings();
                    this.scheduleUpdate(0);
                }
            }),
            blameService.onDidInvalidate(() => this.scheduleUpdate(SELECTION_DELAY_MS))
        );

        this.scheduleUpdate(0);
    }

    public isEnabled(): boolean {
        return this.settings.inlineEnabled;
    }

    public async toggle(): Promise<void> {
        await vscode.workspace
            .getConfiguration(BLAME_CONFIG_SECTION)
            .update('inline.enabled', !this.settings.inlineEnabled, vscode.ConfigurationTarget.Global);
    }

    public dispose(): void {
        if (this.updateTimer) {
            clearTimeout(this.updateTimer);
        }
        this.requestId++;
        this.disposables.forEach((disposable) => disposable.dispose());
        this.disposables.length = 0;
    }

    private scheduleUpdate(delay: number): void {
        if (this.updateTimer) {
            clearTimeout(this.updateTimer);
        }
        this.updateTimer = setTimeout(() => {
            this.updateTimer = undefined;
            void this.update();
        }, delay);
    }

    private clear(): void {
        this.requestId++;
        if (this.decoratedEditor) {
            this.decoratedEditor.setDecorations(this.decorationType, []);
            this.decoratedEditor = undefined;
        }
    }

    private async update(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        const requestId = ++this.requestId;
        if (this.decoratedEditor && this.decoratedEditor !== editor) {
            this.decoratedEditor.setDecorations(this.decorationType, []);
            this.decoratedEditor = undefined;
        }
        if (!editor || !this.settings.inlineEnabled || !BlameService.isBlameable(editor.document)) {
            editor?.setDecorations(this.decorationType, []);
            return;
        }

        try {
            const decoration = await this.buildDecoration(editor);
            if (requestId !== this.requestId || editor !== vscode.window.activeTextEditor) {
                return;
            }
            editor.setDecorations(this.decorationType, decoration ? [decoration] : []);
            this.decoratedEditor = editor;
        } catch (error) {
            logger.debug(`Failed to update inline blame: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async buildDecoration(editor: vscode.TextEditor): Promise<vscode.DecorationOptions | undefined> {
        const { document } = editor;
        const version = document.version;
        const line = editor.selection.active.line;
        const documentBlame = await this.blameService.getBlame(document);
        if (!documentBlame || document.version !== version || line >= document.lineCount) {
            return undefined;
        }

        const hash = documentBlame.blame.lines[line];
        const commit = hash ? documentBlame.blame.commits.get(hash) : undefined;
        if (!commit) {
            return undefined;
        }

        const options = createBlameFormatOptions(this.settings);
        const text = renderBlameTemplate(this.settings.inlineFormat, commit, options).trim();
        if (!text) {
            return undefined;
        }

        let hoverMessage: vscode.MarkdownString | undefined;
        if (this.settings.inlineHoverEnabled) {
            const messages = commit.isUncommitted
                ? new Map<string, string>()
                : await this.blameService.getCommitMessages(documentBlame.service, [commit.hash]);
            hoverMessage = createBlameHover(commit, {
                repoPath: documentBlame.repoPath,
                message: messages.get(commit.hash),
                options,
            });
        }

        const end = document.lineAt(line).range.end;
        return {
            range: new vscode.Range(end, end),
            hoverMessage,
            renderOptions: { after: { contentText: text } },
        };
    }
}
