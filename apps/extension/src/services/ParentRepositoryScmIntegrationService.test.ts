import { describe, expect, it } from 'vitest';
import type { Event } from 'vscode';
import { EventEmitter } from '../test/mocks/vscode';
import type { RepositoryManager, RepositoryScope } from './RepositoryManager';
import {
    findMissingParentGitRoots,
    ParentRepositoryScmIntegrationService
} from './ParentRepositoryScmIntegrationService';

function createScope(workspaceRoot: string, gitRoot: string): RepositoryScope {
    return {
        name: workspaceRoot.split(/[\\/]/).filter(Boolean).pop() || workspaceRoot,
        repoPath: workspaceRoot,
        path: workspaceRoot,
        workspaceRoot,
        gitRoot,
        isSubmodule: false,
        kind: 'workspace'
    };
}

function createRepositoryManager(scopes: RepositoryScope[]): RepositoryManager {
    const repositoriesEmitter = new EventEmitter<void>();
    const activeRepoEmitter = new EventEmitter<string | undefined>();
    return {
        getRepositories: () => scopes,
        onDidChangeRepositories: repositoriesEmitter.event as Event<void>,
        onDidChangeActiveRepo: activeRepoEmitter.event as Event<string | undefined>
    } as RepositoryManager;
}

describe('findMissingParentGitRoots', () => {
    it('skips repositories opened at their git root', () => {
        expect(findMissingParentGitRoots([
            createScope('/repo', '/repo')
        ], [])).toEqual([]);
    });

    it('returns parent git roots that VS Code Git has not opened', () => {
        expect(findMissingParentGitRoots([
            createScope('/repo/backend', '/repo')
        ], [])).toEqual(['/repo']);
    });

    it('does not return parent git roots already opened by VS Code Git', () => {
        expect(findMissingParentGitRoots([
            createScope('/repo/backend', '/repo')
        ], ['/repo'])).toEqual([]);
    });

    it('deduplicates multiple opened folders under the same parent root', () => {
        expect(findMissingParentGitRoots([
            createScope('/repo/backend', '/repo'),
            createScope('/repo/frontend', '/repo')
        ], [])).toEqual(['/repo']);
    });
});

describe('ParentRepositoryScmIntegrationService', () => {
    it('prompts once and opens VS Code parent repositories from the primary action', async () => {
        const messages: Array<{ message: string; items: string[] }> = [];
        const commands: Array<{ command: string; args: unknown[] }> = [];
        const service = new ParentRepositoryScmIntegrationService(
            createRepositoryManager([createScope('/repo/backend', '/repo')]),
            {
                getVSCodeGitRoots: async () => [],
                showWarningMessage: async (message, ...items) => {
                    messages.push({ message, items });
                    return items[0];
                },
                executeCommand: async (command, ...args) => {
                    commands.push({ command, args });
                }
            }
        );

        await service.checkNow();
        await service.checkNow();

        expect(messages).toHaveLength(1);
        expect(messages[0].items).toEqual(['Open Parent Repository', 'Open Git Setting']);
        expect(commands).toEqual([{ command: 'git.openRepositoriesInParentFolders', args: [] }]);
        service.dispose();
    });

    it('opens the Git setting from the secondary action', async () => {
        const commands: Array<{ command: string; args: unknown[] }> = [];
        const service = new ParentRepositoryScmIntegrationService(
            createRepositoryManager([createScope('/repo/backend', '/repo')]),
            {
                getVSCodeGitRoots: async () => [],
                showWarningMessage: async (_message, ...items) => items[1],
                executeCommand: async (command, ...args) => {
                    commands.push({ command, args });
                }
            }
        );

        await service.checkNow();

        expect(commands).toEqual([{
            command: 'workbench.action.openSettings',
            args: ['git.openRepositoryInParentFolders']
        }]);
        service.dispose();
    });

    it('does not prompt when VS Code Git already opened the parent root', async () => {
        let promptCount = 0;
        const service = new ParentRepositoryScmIntegrationService(
            createRepositoryManager([createScope('/repo/backend', '/repo')]),
            {
                getVSCodeGitRoots: async () => ['/repo'],
                showWarningMessage: async () => {
                    promptCount += 1;
                    return undefined;
                }
            }
        );

        await service.checkNow();

        expect(promptCount).toBe(0);
        service.dispose();
    });

    it('fails closed when VS Code Git roots are unavailable', async () => {
        let promptCount = 0;
        const service = new ParentRepositoryScmIntegrationService(
            createRepositoryManager([createScope('/repo/backend', '/repo')]),
            {
                getVSCodeGitRoots: async () => undefined,
                showWarningMessage: async () => {
                    promptCount += 1;
                    return undefined;
                }
            }
        );

        await service.checkNow();

        expect(promptCount).toBe(0);
        service.dispose();
    });
});
