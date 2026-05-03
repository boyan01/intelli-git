import * as vscode from 'vscode';
import { GitService } from '../services/GitService';
import { ChangelistStateService } from '../services/ChangelistStateService';
import { InactiveChangesService } from '../services/InactiveChangesService';
import { CommitViewProvider } from '../providers/CommitViewProvider';
import { i18n } from '../utils/i18n';
import { logger } from '../utils/logger';
import { EditorHunkResolver, type EditorHunkDecoration, type EditorHunkInfo } from './EditorHunkResolver';

type ChangeBlockDecorationScope = 'off' | 'diffOnly' | 'allEditors';

export class ChangeBlockEditorController implements vscode.Disposable {
    private readonly resolver: EditorHunkResolver;
    private readonly statusBarItem: vscode.StatusBarItem;
    private readonly decorationType: vscode.TextEditorDecorationType;
    private readonly inactiveDecorationType: vscode.TextEditorDecorationType;
    private readonly disposables: vscode.Disposable[] = [];
    private updateTimer?: NodeJS.Timeout;

    constructor(
        private readonly gitService: GitService,
        inactiveChangesService: InactiveChangesService,
        changelistStateService: ChangelistStateService,
        private readonly provider: CommitViewProvider
    ) {
        this.resolver = new EditorHunkResolver(gitService, inactiveChangesService, changelistStateService);
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 95);
        this.statusBarItem.command = 'intelli-git.currentChangeBlock.actions';
        this.decorationType = vscode.window.createTextEditorDecorationType({
            after: {
                margin: '0 0 0 2em',
                color: new vscode.ThemeColor('editorCodeLens.foreground'),
                fontStyle: 'normal'
            }
        });
        this.inactiveDecorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor('editorUnnecessaryCode.opacity'),
            overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.deletedForeground'),
            overviewRulerLane: vscode.OverviewRulerLane.Right
        });

        this.disposables.push(
            this.statusBarItem,
            this.decorationType,
            this.inactiveDecorationType,
            vscode.window.onDidChangeVisibleTextEditors(() => this.scheduleUpdate()),
            vscode.window.onDidChangeActiveTextEditor(() => this.scheduleUpdate()),
            vscode.window.onDidChangeTextEditorSelection(() => this.scheduleUpdateContext()),
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration('intelli-git.changelist.mode') || event.affectsConfiguration('intelli-git.editor.changeBlockDecorations')) {
                    this.resolver.invalidate();
                    this.scheduleUpdate();
                }
            }),
            this.gitService.onDidChange(() => {
                this.resolver.invalidate();
                this.scheduleUpdate();
            }),
            vscode.commands.registerCommand('intelli-git.currentChangeBlock.actions', () => this.showCurrentActions()),
            vscode.commands.registerCommand('intelli-git.revealCurrentChangeBlock', () => this.revealCurrentChangeBlock()),
            vscode.commands.registerCommand('intelli-git.refreshChangeBlockDecorations', () => this.refresh()),
            vscode.languages.registerCodeActionsProvider(
                [
                    { scheme: 'file' },
                    { scheme: 'git' },
                    { scheme: 'intelli-git-revision' }
                ],
                {
                    provideCodeActions: (document, range) => this.provideCodeActions(document, range)
                },
                {
                    providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
                }
            )
        );

        this.scheduleUpdate();
    }

    public dispose(): void {
        if (this.updateTimer) {
            clearTimeout(this.updateTimer);
        }
        void vscode.commands.executeCommand('setContext', 'intelli-git.hasCurrentChangeBlock', false);
        void vscode.commands.executeCommand('setContext', 'intelli-git.currentChangeBlockInactive', false);
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }

    public refresh(): void {
        this.resolver.invalidate();
        this.scheduleUpdate();
    }

    private scheduleUpdate(): void {
        if (this.updateTimer) {
            clearTimeout(this.updateTimer);
        }
        this.updateTimer = setTimeout(() => {
            void this.updateAll();
        }, 150);
    }

    private scheduleUpdateContext(): void {
        if (this.updateTimer) {
            clearTimeout(this.updateTimer);
        }
        this.updateTimer = setTimeout(() => {
            void this.updateCurrentContext();
        }, 120);
    }

    private async updateAll(): Promise<void> {
        try {
            await Promise.all(vscode.window.visibleTextEditors.map(editor => this.decorateEditor(editor)));
            await this.updateCurrentContext();
        } catch (e) {
            logger.warn('Failed to update change block editor decorations', e);
        }
    }

    private async decorateEditor(editor: vscode.TextEditor): Promise<void> {
        const scope = this.getDecorationScope();
        if (scope === 'off' || (scope === 'diffOnly' && !this.isDiffLikeEditor(editor))) {
            editor.setDecorations(this.decorationType, []);
            editor.setDecorations(this.inactiveDecorationType, []);
            return;
        }

        const decorations = await this.resolver.getDecorations(editor, {
            showDefaultStagedBlocks: this.isDiffLikeEditor(editor)
        });
        const labelOptions = decorations.map(decoration => this.createLabelDecoration(editor, decoration));
        const inactiveOptions = decorations
            .filter(decoration => decoration.inactive)
            .map(decoration => {
                const startLine = decoration.startLine - 1;
                const endLine = decoration.endLine - 1;
                const endCharacter = editor.document.lineAt(endLine).range.end.character;
                return new vscode.Range(startLine, 0, endLine, endCharacter);
            });

        editor.setDecorations(this.decorationType, labelOptions);
        editor.setDecorations(this.inactiveDecorationType, inactiveOptions);
    }

    private createLabelDecoration(editor: vscode.TextEditor, decoration: EditorHunkDecoration): vscode.DecorationOptions {
        const line = decoration.startLine - 1;
        const textLine = editor.document.lineAt(Math.min(Math.max(line, 0), editor.document.lineCount - 1));
        return {
            range: new vscode.Range(line, textLine.range.end.character, line, textLine.range.end.character),
            renderOptions: {
                after: {
                    contentText: decoration.label
                }
            },
            hoverMessage: this.createHover(decoration)
        };
    }

    private createHover(info: EditorHunkInfo): vscode.MarkdownString {
        const markdown = new vscode.MarkdownString(undefined, true);
        markdown.isTrusted = true;
        const parts: string[] = [];

        if (info.mode === 'staged') {
            parts.push(info.fileStatus.staged ? i18n.t('Staged') : i18n.t('Unstaged'));
            if (info.inactive) {
                parts.push(i18n.t('Inactive'));
            }
        } else {
            if (info.changelist && !info.isActiveChangelist) {
                parts.push(info.changelist.name);
            }
            if (info.inactive) {
                parts.push(i18n.t('Inactive'));
            }
        }

        markdown.appendMarkdown(`**Intelli Git**  \n${parts.length > 0 ? parts.join(' · ') : i18n.t('Default change block')}`);
        markdown.appendMarkdown('\n\n');

        if (info.mode === 'changes') {
            markdown.appendMarkdown(`[${i18n.t('Move to Changelist...')}](${this.createCommandUri('intelli-git.changelist.moveToList', {
                webviewSection: 'changelistHunk',
                path: info.path,
                hunkId: info.hunk.id,
                changelistId: info.changelist?.id
            })})`);
        } else {
            markdown.appendMarkdown(`[${info.inactive ? i18n.t('Move to Active Changes') : i18n.t('Mark as Inactive Changes')}](${this.createCommandUri(info.inactive ? 'intelli-git.moveHunkToActive' : 'intelli-git.moveHunkToInactive', {
                path: info.path,
                hunkId: info.hunk.id
            })})`);
        }

        return markdown;
    }

    private async updateCurrentContext(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        const info = editor ? await this.resolver.resolveCurrent(editor) : undefined;
        await vscode.commands.executeCommand('setContext', 'intelli-git.hasCurrentChangeBlock', Boolean(info));
        await vscode.commands.executeCommand('setContext', 'intelli-git.currentChangeBlockInactive', Boolean(info?.inactive));

        if (!info) {
            this.statusBarItem.hide();
            return;
        }

        this.statusBarItem.text = `$(git-commit) ${this.getStatusBarText(info)}`;
        this.statusBarItem.tooltip = this.getStatusBarTooltip(info);
        this.statusBarItem.show();
    }

    private getStatusBarText(info: EditorHunkInfo): string {
        if (info.mode === 'staged') {
            const parts = [info.fileStatus.staged ? i18n.t('Staged') : i18n.t('Unstaged')];
            if (info.inactive) {
                parts.push(i18n.t('Inactive'));
            }
            return parts.join(' · ');
        }

        if (info.inactive) {
            return i18n.t('Inactive');
        }

        if (info.changelist && !info.isDefaultChangelist) {
            return info.changelist.name;
        }

        return i18n.t('Default changelist');
    }

    private getStatusBarTooltip(info: EditorHunkInfo): string {
        if (info.mode === 'changes') {
            const listName = info.changelist?.name || 'Changes';
            return `Intelli Git: ${listName}${info.inactive ? ` · ${i18n.t('Inactive')}` : ''}`;
        }
        return `Intelli Git: ${info.fileStatus.staged ? i18n.t('Staged') : i18n.t('Unstaged')}${info.inactive ? ` · ${i18n.t('Inactive')}` : ''}`;
    }

    private async showCurrentActions(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        const info = editor ? await this.resolver.resolveCurrent(editor) : undefined;
        if (!info) {
            vscode.window.showWarningMessage(i18n.t('No modified change block found at line {0} in {1}', 0, ''));
            return;
        }

        const actions: Array<{ label: string; command: string }> = [
            { label: i18n.t('Reveal in Commit Panel'), command: 'intelli-git.revealCurrentChangeBlock' }
        ];

        if (info.mode === 'staged') {
            actions.unshift({
                label: info.inactive ? i18n.t('Move to Active Changes') : i18n.t('Mark as Inactive Changes'),
                command: info.inactive ? 'intelli-git.moveHunkToActive' : 'intelli-git.moveHunkToInactive'
            });
        } else {
            actions.unshift({ label: i18n.t('Move to Changelist...'), command: 'intelli-git.changelist.moveToList' });
        }

        const picked = await vscode.window.showQuickPick(actions, {
            placeHolder: this.getStatusBarTooltip(info)
        });
        if (!picked) {
            return;
        }

        await vscode.commands.executeCommand(picked.command);
    }

    private async revealCurrentChangeBlock(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        const info = editor ? await this.resolver.resolveCurrent(editor) : undefined;
        if (!info) {
            return;
        }

        await vscode.commands.executeCommand('intelliGitView.focus');
        await this.provider.rpc?.activeFileChange({ path: info.path });
    }

    private async provideCodeActions(document: vscode.TextDocument, range: vscode.Range): Promise<vscode.CodeAction[]> {
        const info = await this.resolver.resolveAt(document, range.start.line + 1);
        if (!info) {
            return [];
        }

        const actions: vscode.CodeAction[] = [];

        if (info.mode === 'changes') {
            const moveAction = new vscode.CodeAction(i18n.t('Move to Changelist...'), vscode.CodeActionKind.QuickFix);
            moveAction.command = {
                command: 'intelli-git.changelist.moveToList',
                title: i18n.t('Move to Changelist...'),
                arguments: [{
                    webviewSection: 'changelistHunk',
                    path: info.path,
                    hunkId: info.hunk.id,
                    changelistId: info.changelist?.id
                }]
            };
            actions.push(moveAction);
        } else {
            const inactiveTitle = info.inactive ? i18n.t('Move to Active Changes') : i18n.t('Mark as Inactive Changes');
            const inactiveAction = new vscode.CodeAction(inactiveTitle, vscode.CodeActionKind.QuickFix);
            inactiveAction.command = {
                command: info.inactive ? 'intelli-git.moveHunkToActive' : 'intelli-git.moveHunkToInactive',
                title: inactiveTitle,
                arguments: [{ path: info.path, hunkId: info.hunk.id }]
            };
            actions.push(inactiveAction);
        }

        const revealAction = new vscode.CodeAction(i18n.t('Reveal in Commit Panel'), vscode.CodeActionKind.QuickFix);
        revealAction.command = {
            command: 'intelli-git.revealCurrentChangeBlock',
            title: i18n.t('Reveal in Commit Panel')
        };
        actions.push(revealAction);

        return actions;
    }

    private getDecorationScope(): ChangeBlockDecorationScope {
        return vscode.workspace.getConfiguration('intelli-git').get<ChangeBlockDecorationScope>('editor.changeBlockDecorations', 'allEditors');
    }

    private isDiffLikeEditor(editor: vscode.TextEditor): boolean {
        return editor.document.uri.scheme !== 'file';
    }

    private createCommandUri(command: string, arg: unknown): vscode.Uri {
        return vscode.Uri.parse(`command:${command}?${encodeURIComponent(JSON.stringify([arg]))}`);
    }
}
