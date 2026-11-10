import * as path from 'path';
import * as vscode from 'vscode';
import type { InlineBlameController } from '../editor/blame/InlineBlameController';
import type { BlameLineTarget, GutterBlameController } from '../editor/blame/GutterBlameController';
import { toggleBlameColumn, type BlameColumn } from '../editor/blame/blameFormat';
import {
    BLAME_CONFIG_SECTION,
    readBlameSettings,
    type BlameCommandArgs,
    type BlameGutterColorBy,
} from '../editor/blame/blameUi';
import { GitLogViewProvider } from '../providers/GitLogViewProvider';
import { RepositoryManager } from '../services/RepositoryManager';
import { createRevisionContentUri } from '../utils/repositoryContentUri';

const EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

function isBlameCommandArgs(value: unknown): value is BlameCommandArgs {
    const args = value as BlameCommandArgs | undefined;
    return typeof args?.repoPath === 'string' && typeof args.hash === 'string' && /^[0-9a-f]{7,64}$/i.test(args.hash);
}

/**
 * Accepts the URI passed by `editor/title` and `editor/context`, and the `{ uri }` object passed
 * by `editor/lineNumber/context`.
 */
function toUri(value: unknown): vscode.Uri | undefined {
    if (value instanceof vscode.Uri) {
        return value;
    }
    const uri = (value as { uri?: unknown } | undefined)?.uri;
    return uri instanceof vscode.Uri ? uri : undefined;
}

/**
 * Resolves the line a menu was opened on: the clicked line number for `editor/lineNumber/context`,
 * otherwise the cursor line, which a right click inside the editor moves to the clicked position.
 */
function toLine(value: unknown): { uri: vscode.Uri; line: number } | undefined {
    const lineNumber = (value as { lineNumber?: unknown } | undefined)?.lineNumber;
    const uri = toUri(value);
    if (uri && typeof lineNumber === 'number') {
        return { uri, line: lineNumber - 1 };
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor || (uri && editor.document.uri.toString() !== uri.toString())) {
        return undefined;
    }
    return { uri: editor.document.uri, line: editor.selection.active.line };
}

function toCommandArgs(target: BlameLineTarget): BlameCommandArgs | undefined {
    const { commit, documentBlame } = target;
    if (commit.isUncommitted) {
        return undefined;
    }
    return {
        repoPath: documentBlame.repoPath,
        hash: commit.hash,
        filePath: commit.filename,
        previousHash: commit.previousHash,
        previousFilePath: commit.previousFilename,
    };
}

export function registerBlameCommands(
    context: vscode.ExtensionContext,
    repositoryManager: RepositoryManager,
    gitLogProvider: GitLogViewProvider,
    inlineBlame: InlineBlameController,
    gutterBlame: GutterBlameController
): void {
    const openCommitInLog = async (args: BlameCommandArgs) => {
        try {
            if (repositoryManager.getService(args.repoPath)) {
                repositoryManager.setActiveRepository(args.repoPath);
            }
            await gitLogProvider.revealLog({ hash: args.hash });
        } catch (error) {
            void vscode.window.showErrorMessage(
                vscode.l10n.t(
                    'Failed to open blame commit in Git Log: {0}',
                    error instanceof Error ? error.message : String(error)
                )
            );
        }
    };

    const showCommitDiff = async (args: BlameCommandArgs) => {
        const gitService = repositoryManager.getService(args.repoPath);
        if (!gitService || !args.filePath) {
            return;
        }

        const leftRef = args.previousHash ?? EMPTY_TREE_HASH;
        const leftUri = createRevisionContentUri(gitService, args.previousFilePath ?? args.filePath, {
            ref: leftRef,
            pathKind: 'repo',
        });
        const rightUri = createRevisionContentUri(gitService, args.filePath, {
            ref: args.hash,
            pathKind: 'repo',
        });
        const leftLabel = args.previousHash ? args.previousHash.substring(0, 7) : '\u2205';
        const title = `${path.basename(args.filePath)} (${leftLabel} \u2194 ${args.hash.substring(0, 7)})`;
        await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
    };

    /**
     * Opens the file as of the line's commit (or the commit before it) and annotates that revision.
     */
    const annotateRevision = async (target: BlameLineTarget, previous: boolean) => {
        const { commit, documentBlame } = target;
        if (commit.isUncommitted) {
            void vscode.window.showInformationMessage(vscode.l10n.t('The selected line has no committed revision.'));
            return;
        }
        if (previous && !commit.previousHash) {
            void vscode.window.showInformationMessage(
                vscode.l10n.t('The selected revision has no earlier version of this file.')
            );
            return;
        }

        const ref = previous ? commit.previousHash! : commit.hash;
        const filePath = previous ? (commit.previousFilename ?? commit.filename) : commit.filename;
        const uri = createRevisionContentUri(documentBlame.service, filePath, { ref, pathKind: 'repo' });
        const document = await vscode.workspace.openTextDocument(uri);
        const line = Math.min(Math.max(0, target.originalLine - 1), Math.max(0, document.lineCount - 1));
        const editor = await vscode.window.showTextDocument(document, {
            preview: true,
            selection: new vscode.Range(line, 0, line, 0),
        });
        editor.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        await gutterBlame.annotate(document.uri);
    };

    const registerLineCommand = (command: string, run: (target: BlameLineTarget) => Promise<void> | void) =>
        vscode.commands.registerCommand(command, async (value?: unknown) => {
            const location = toLine(value);
            const target = location ? await gutterBlame.getLineTarget(location.uri, location.line) : undefined;
            if (target) {
                await run(target);
            }
        });

    const registerCommitLineCommand = (command: string, run: (args: BlameCommandArgs) => Promise<void> | void) =>
        registerLineCommand(command, async (target) => {
            const args = toCommandArgs(target);
            if (args) {
                await run(args);
            } else {
                void vscode.window.showInformationMessage(
                    vscode.l10n.t('The selected line has no committed revision.')
                );
            }
        });

    const toggleColumn = async (column: BlameColumn) => {
        const format = readBlameSettings().gutterFormat;
        const next = toggleBlameColumn(format, column);
        if (next !== format) {
            await vscode.workspace
                .getConfiguration(BLAME_CONFIG_SECTION)
                .update('gutter.format', next, vscode.ConfigurationTarget.Global);
        }
    };

    const setColorBy = (colorBy: BlameGutterColorBy) =>
        vscode.workspace
            .getConfiguration(BLAME_CONFIG_SECTION)
            .update('gutter.colorBy', colorBy, vscode.ConfigurationTarget.Global);

    context.subscriptions.push(
        gutterBlame.onDidClickAnnotation(async (target) => {
            const args = toCommandArgs(target);
            if (args) {
                await openCommitInLog(args);
            }
        }),
        vscode.commands.registerCommand('intelli-git.blame.toggleInline', () => inlineBlame.toggle()),
        vscode.commands.registerCommand('intelli-git.blame.toggleFileAnnotations', (target?: unknown) =>
            gutterBlame.toggle(toUri(target))
        ),
        vscode.commands.registerCommand('intelli-git.blame.annotateFile', (target?: unknown) =>
            gutterBlame.annotate(toUri(target))
        ),
        vscode.commands.registerCommand('intelli-git.blame.closeFileAnnotations', (target?: unknown) =>
            gutterBlame.close(toUri(target))
        ),
        vscode.commands.registerCommand('intelli-git.blame.openCommitInLog', async (args?: unknown) => {
            if (isBlameCommandArgs(args)) {
                await openCommitInLog(args);
            }
        }),
        vscode.commands.registerCommand('intelli-git.blame.showCommitDiff', async (args?: unknown) => {
            if (isBlameCommandArgs(args)) {
                await showCommitDiff(args);
            }
        }),
        registerCommitLineCommand('intelli-git.blame.annotation.showDiff', showCommitDiff),
        registerCommitLineCommand('intelli-git.blame.annotation.showInGitLog', openCommitInLog),
        registerCommitLineCommand('intelli-git.blame.annotation.copyRevision', async (args) => {
            await vscode.commands.executeCommand('intelli-git.copyCommitHash', { hash: args.hash });
        }),
        registerLineCommand('intelli-git.blame.annotation.annotateRevision', (target) =>
            annotateRevision(target, false)
        ),
        registerLineCommand('intelli-git.blame.annotation.annotatePreviousRevision', (target) =>
            annotateRevision(target, true)
        ),
        // Extension menus cannot show check marks, so every option has a `.checked` twin whose
        // title carries the mark; the menu shows whichever matches the current setting.
        ...(
            [
                ['toggleDate', () => toggleColumn('date')],
                ['toggleAuthor', () => toggleColumn('author')],
                ['toggleCommit', () => toggleColumn('commit')],
                ['toggleMessage', () => toggleColumn('message')],
                ['colorByAge', () => setColorBy('age')],
                ['colorByAuthor', () => setColorBy('author')],
                ['noColors', () => setColorBy('none')],
            ] as Array<[string, () => Thenable<void>]>
        ).flatMap(([name, run]) => [
            vscode.commands.registerCommand(`intelli-git.blame.gutter.${name}`, run),
            vscode.commands.registerCommand(`intelli-git.blame.gutter.${name}.checked`, run),
        ])
    );
}
