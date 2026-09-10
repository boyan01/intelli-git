import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import { registerAiCommands } from './aiCommands';

const mocks = vi.hoisted(() => ({
    callbacks: new Map<string, (...args: unknown[]) => unknown>(),
    quickPick: vi.fn(), input: vi.fn(), update: vi.fn(), listModels: vi.fn(),
    token: { isCancellationRequested: false }
}));
vi.mock('../services/CodexCliService', () => ({ listCodexModels: mocks.listModels }));
vi.mock('../utils/aiSecrets', () => ({ getAiApiKey: async () => '', setAiApiKey: vi.fn() }));
vi.mock('vscode', async importOriginal => {
    const actual = await importOriginal<typeof import('vscode')>();
    return {
        ...actual,
        commands: { ...actual.commands, registerCommand: (name: string, callback: (...args: unknown[]) => unknown) => {
            mocks.callbacks.set(name, callback);
            return { dispose() {} };
        } },
        workspace: { ...actual.workspace, getConfiguration: () => ({
            get: (key: string, fallback: unknown) => ({ provider: 'codex', model: 'existing', path: '/opt/codex' }[key] ?? fallback),
            update: mocks.update
        }) },
        window: { ...actual.window,
            showQuickPick: mocks.quickPick,
            showInputBox: mocks.input,
            withProgress: async (_options: unknown, callback: (progress: unknown, token: unknown) => unknown) => callback({}, mocks.token)
        }
    };
});

beforeEach(() => {
    vi.clearAllMocks();
    mocks.quickPick.mockReset();
    mocks.quickPick.mockResolvedValue({ effort: '' });
    mocks.input.mockReset();
    mocks.listModels.mockReset();
    mocks.token.isCancellationRequested = false;
    registerAiCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
    mocks.quickPick.mockResolvedValueOnce({ id: 'codex' }).mockResolvedValueOnce({ action: 'changeModel' });
    mocks.listModels.mockResolvedValue([
        { model: 'new-model', displayName: 'New Model', description: 'Available model', isDefault: true, defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Fast' }, { reasoningEffort: 'high', description: 'Thorough' }] }
    ]);
});

function configure() {
    return mocks.callbacks.get('intelli-git.ai.configureProvider')!();
}

describe('Codex model picker', () => {
    it('shows discovered models and the current custom model, then saves the selected ID', async () => {
        mocks.quickPick.mockResolvedValueOnce({ model: 'new-model' });
        await configure();
        const items = mocks.quickPick.mock.calls[2][0];
        expect(items).toEqual(expect.arrayContaining([
            expect.objectContaining({ label: 'New Model', model: 'new-model' }),
            expect.objectContaining({ label: 'existing', model: 'existing' }),
            expect.objectContaining({ model: '' }),
            expect.objectContaining({ action: 'manual' })
        ]));
        expect(mocks.listModels).toHaveBeenCalledWith('/opt/codex', mocks.token);
        expect(mocks.update).toHaveBeenCalledWith('model', 'new-model', expect.anything());
    });

    it('clears the override when selecting the CLI default', async () => {
        mocks.quickPick.mockResolvedValueOnce({ model: '' });
        await configure();
        expect(mocks.update).toHaveBeenCalledWith('model', '', expect.anything());
    });

    it('preserves the configured model when the picker is dismissed', async () => {
        mocks.quickPick.mockResolvedValueOnce(undefined);
        await configure();
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it('keeps manual entry available after discovery fails', async () => {
        mocks.listModels.mockRejectedValue(new Error('Unavailable'));
        mocks.quickPick.mockResolvedValueOnce({ action: 'manual' });
        mocks.input.mockResolvedValue(' custom-model ');
        await configure();
        expect(mocks.quickPick.mock.calls[2][0]).toContainEqual(expect.objectContaining({ action: 'retry' }));
        expect(mocks.update).toHaveBeenCalledWith('model', 'custom-model', expect.anything());
    });

    it('retries discovery and saves only the eventual selection', async () => {
        mocks.listModels.mockRejectedValueOnce(new Error('Unavailable'));
        mocks.quickPick.mockResolvedValueOnce({ action: 'retry' }).mockResolvedValueOnce({ model: 'new-model' });
        await configure();
        expect(mocks.listModels).toHaveBeenCalledTimes(2);
        expect(mocks.update).toHaveBeenCalledWith('model', 'new-model', expect.anything());
        expect(mocks.update).toHaveBeenCalledTimes(2);
    });

    it('does not open a picker or change settings after cancelling discovery', async () => {
        mocks.listModels.mockImplementation(async () => {
            mocks.token.isCancellationRequested = true;
            throw new Error('Cancelled');
        });
        await configure();
        expect(mocks.quickPick).toHaveBeenCalledTimes(2);
        expect(mocks.update).not.toHaveBeenCalled();
    });
});


describe('Codex reasoning effort picker', () => {
    it('offers only the selected model capabilities and saves the selected effort', async () => {
        mocks.quickPick.mockResolvedValueOnce({ model: 'new-model' }).mockResolvedValueOnce({ effort: 'high' });
        await configure();
        const efforts = mocks.quickPick.mock.calls[3][0];
        expect(efforts.map((item: { effort: string }) => item.effort)).toEqual(['', 'low', 'high']);
        expect(mocks.update).toHaveBeenCalledWith('reasoningEffort', 'high', expect.anything());
        expect(mocks.update).toHaveBeenCalledWith('model', 'new-model', expect.anything());
    });

    it('preserves both settings when cancelling effort selection', async () => {
        mocks.quickPick.mockResolvedValueOnce({ model: 'new-model' }).mockResolvedValueOnce(undefined);
        await configure();
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it('uses only the default effort when a manual model has no capability metadata', async () => {
        mocks.quickPick.mockResolvedValueOnce({ action: 'manual' });
        mocks.input.mockResolvedValue('unknown-model');
        await configure();
        expect(mocks.quickPick.mock.calls[3][0].map((item: { effort: string }) => item.effort)).toEqual(['']);
        expect(mocks.update).toHaveBeenCalledWith('reasoningEffort', '', expect.anything());
    });

    it('uses the default model capabilities when selecting the CLI default', async () => {
        mocks.quickPick.mockResolvedValueOnce({ model: '' }).mockResolvedValueOnce({ effort: 'low' });
        await configure();
        expect(mocks.quickPick.mock.calls[3][0].map((item: { effort: string }) => item.effort)).toEqual(['', 'low', 'high']);
        expect(mocks.update).toHaveBeenCalledWith('reasoningEffort', 'low', expect.anything());
    });
});
