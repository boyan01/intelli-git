import { beforeEach, describe, expect, it } from 'vitest';
import type * as vscode from 'vscode';
import * as vscodeMock from 'vscode';
import type { RepositoryManager } from '../services/RepositoryManager';
import { openConflictFile } from './ConflictResolverPanel';
import type { WebviewProviderOptions } from './BaseWebviewProvider';

const testVscode = vscodeMock as unknown as {
    __getExecutedCommands(): Array<{ command: string; args: unknown[] }>;
    __resetExecutedCommands(): void;
};

describe('openConflictFile', () => {
    beforeEach(() => {
        testVscode.__resetExecutedCommands();
    });

    it('opens conflicts in the standard editor when the merge editor is disabled by default', async () => {
        const options: WebviewProviderOptions = {
            extensionUri: {} as vscode.Uri,
            context: {} as vscode.ExtensionContext,
            repositoryManager: {} as RepositoryManager,
        };

        await openConflictFile(options, {
            path: 'src/conflict.ts',
            repoPath: '/workspace/repository',
        });

        const [command] = testVscode.__getExecutedCommands();
        expect(command.command).toBe('vscode.open');
        expect((command.args[0] as vscode.Uri).fsPath).toBe('/workspace/repository/src/conflict.ts');
    });
});
