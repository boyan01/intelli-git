import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { access, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { logger } from '../utils/logger';
import { CodexCliLanguageModel, listCodexModels } from './CodexCliService';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('vscode', async (importOriginal) => {
    const actual = await importOriginal<typeof import('vscode')>();
    return { ...actual, workspace: { ...actual.workspace, isTrusted: true } };
});

let child: EventEmitter & {
    pid: number;
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
};
let args: string[];
let directory: string;
let input: string;
let cancel: () => void;
let dispose: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
    args = [];
    input = '';
    dispose = vi.fn();
    Object.assign(vscode.workspace, { isTrusted: true });
    child = Object.assign(new EventEmitter(), {
        pid: 99999,
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(),
    });
    child.stdin.on('data', (chunk) => {
        input += chunk.toString();
    });
    vi.mocked(spawn).mockImplementation(((_executable: string, supplied: string[], options: { cwd: string }) => {
        args = supplied;
        directory = options.cwd;
        return child;
    }) as unknown as typeof spawn);
    vi.spyOn(process, 'kill').mockImplementation(() => {
        queueMicrotask(() => child.emit('close', null));
        return true;
    });
    vi.spyOn(vscode.window, 'withProgress').mockImplementation(async (_options, task) =>
        task(
            { report() {} },
            {
                isCancellationRequested: false,
                onCancellationRequested: (listener) => {
                    cancel = () => listener(undefined);
                    return { dispose };
                },
            }
        )
    );
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.mocked(spawn).mockReset();
});

function generate(model = '') {
    return new CodexCliLanguageModel('/opt/codex bin/codex', model).sendRequest(
        [vscode.LanguageModelChatMessage.User('Diff:\n+literal $(touch unsafe); `command`\n+中文')],
        {},
        {
            isCancellationRequested: false,
            onCancellationRequested: (listener) => {
                cancel = () => listener(undefined);
                return { dispose };
            },
        }
    );
}

async function started() {
    await vi.waitFor(() => expect(args.length).toBeGreaterThan(0));
}

async function finish(text = 'Improve commit generation\n\n- Preserve the selected diff.') {
    await writeFile(args[args.indexOf('--output-last-message') + 1], text);
    child.emit('close', 0);
}

describe('Codex CLI generation', () => {
    it('passes the exact prompt through stdin and reads only the final output file', async () => {
        const pending = generate('test-model');
        await started();
        expect(input).toContain('+literal $(touch unsafe); `command`\n+中文');
        expect(args).not.toContain(input);
        expect(args).toContain('--ignore-user-config');
        expect(args).toContain('read-only');
        expect(args.slice(-3)).toEqual(['--model', 'test-model', '-']);
        expect(spawn).toHaveBeenCalledWith(
            '/opt/codex bin/codex',
            args,
            expect.objectContaining({ shell: false, cwd: directory })
        );
        child.stderr.write('Progress and reasoning must not become the commit message');
        await finish();
        const result = await pending;
        let text = '';
        for await (const part of result.text) {
            text += part;
        }
        expect(text).toBe('Improve commit generation\n\n- Preserve the selected diff.');
        await expect(access(directory)).rejects.toThrow();
        expect(dispose).toHaveBeenCalledOnce();
        expect(vscode.window.withProgress).not.toHaveBeenCalled();
    });

    it('reports a missing executable and removes temporary files', async () => {
        const pending = generate();
        const assertion = expect(pending).rejects.toThrow('executable not found');
        await started();
        child.emit('error', Object.assign(new Error('missing'), { code: 'ENOENT' }));
        child.emit('close', -2);
        await assertion;
        await expect(access(directory)).rejects.toThrow();
    });

    it('rejects a failed invocation even when a partial final file exists', async () => {
        const pending = generate();
        const assertion = expect(pending).rejects.toThrow('Please login');
        await started();
        await writeFile(args[args.indexOf('--output-last-message') + 1], 'Partial response');
        child.stderr.write('Please login');
        child.emit('close', 1);
        await assertion;
    });

    it('rejects an empty final response', async () => {
        const pending = generate();
        const assertion = expect(pending).rejects.toThrow('no usable final text');
        await started();
        await finish('  ');
        await assertion;
    });

    it('kills the process group when the user cancels', async () => {
        const pending = generate();
        const assertion = expect(pending).rejects.toThrow('cancelled');
        await started();
        cancel();
        await assertion;
        expect(process.kill).toHaveBeenCalledWith(-99999, 'SIGKILL');
        await expect(access(directory)).rejects.toThrow();
    });

    it('ends a hung process after the timeout', async () => {
        vi.useFakeTimers();
        const pending = generate();
        const assertion = expect(pending).rejects.toThrow('120 seconds');
        await started();
        await vi.advanceTimersByTimeAsync(120000);
        await assertion;
        expect(process.kill).toHaveBeenCalledWith(-99999, 'SIGKILL');
    });

    it('does not launch a command in an untrusted workspace', async () => {
        Object.assign(vscode.workspace, { isTrusted: false });
        await expect(generate()).rejects.toThrow('Trust this workspace');
        expect(spawn).not.toHaveBeenCalled();
    });
});

function discover() {
    return listCodexModels('/opt/codex bin/codex', {
        isCancellationRequested: false,
        onCancellationRequested: (listener) => {
            cancel = () => listener(undefined);
            return { dispose };
        },
    });
}

function reply(id: number, result: object) {
    const encoded = JSON.stringify({ id, result }) + '\n';
    child.stdout.write(encoded.slice(0, 7));
    child.stdout.write(encoded.slice(7));
}

describe('Codex model discovery', () => {
    it('initializes before listing models, follows pagination, and cleans up the process', async () => {
        const pending = discover();
        await started();
        expect(args.slice(0, 3)).toEqual(['app-server', '--listen', 'stdio://']);
        expect(JSON.parse(input).method).toBe('initialize');
        reply(0, { userAgent: 'codex' });
        let requests = input
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
        expect(requests.map((request) => request.method)).toEqual(['initialize', 'initialized', 'model/list']);
        reply(1, {
            data: [
                {
                    model: 'first',
                    displayName: 'First Model',
                    description: 'First description',
                    isDefault: true,
                    defaultReasoningEffort: 'low',
                    supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Fast' }],
                },
                { model: 'hidden', hidden: true },
            ],
            nextCursor: 'page-2',
        });
        requests = input
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
        expect(requests.at(-1).params.cursor).toBe('page-2');
        reply(2, { data: [{ model: 'second', displayName: 'Second Model' }], nextCursor: null });
        await expect(pending).resolves.toEqual([
            {
                model: 'first',
                displayName: 'First Model',
                description: 'First description',
                isDefault: true,
                defaultReasoningEffort: 'low',
                supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Fast' }],
            },
            {
                model: 'second',
                displayName: 'Second Model',
                description: '',
                isDefault: false,
                defaultReasoningEffort: '',
                supportedReasoningEfforts: [],
            },
        ]);
        expect(input).not.toContain('thread/start');
        expect(process.kill).toHaveBeenCalledWith(-99999, 'SIGKILL');
        await expect(access(directory)).rejects.toThrow();
        expect(dispose).toHaveBeenCalledOnce();
    });

    it('rejects repeated pagination cursors instead of looping', async () => {
        const pending = discover();
        const assertion = expect(pending).rejects.toThrow('invalid model list');
        await started();
        reply(0, {});
        reply(1, { data: [], nextCursor: 'repeat' });
        reply(2, { data: [], nextCursor: 'repeat' });
        await assertion;
    });

    it('reports protocol errors and does not return a partial catalog', async () => {
        const pending = discover();
        const assertion = expect(pending).rejects.toThrow('Login required');
        await started();
        reply(0, {});
        child.stdout.write(JSON.stringify({ id: 1, error: { message: 'Login required' } }) + '\n');
        await assertion;
        await expect(access(directory)).rejects.toThrow();
    });

    it('rejects an early process exit', async () => {
        const pending = discover();
        const assertion = expect(pending).rejects.toThrow('Codex CLI failed');
        await started();
        child.emit('close', 1);
        await assertion;
    });

    it('cancels discovery and removes its temporary directory', async () => {
        const pending = discover();
        const assertion = expect(pending).rejects.toThrow('cancelled');
        await started();
        cancel();
        await assertion;
        await expect(access(directory)).rejects.toThrow();
    });

    it('times out model discovery independently of generation', async () => {
        vi.useFakeTimers();
        const pending = discover();
        const assertion = expect(pending).rejects.toThrow('15 seconds');
        await started();
        await vi.advanceTimersByTimeAsync(15000);
        await assertion;
    });
});

describe('Codex generation reasoning effort', () => {
    it('passes an explicit effort to exec as a config argument', async () => {
        const pending = new CodexCliLanguageModel('/opt/codex', 'test-model', 'high').sendRequest([
            vscode.LanguageModelChatMessage.User('Generate a commit subject'),
        ]);
        await started();
        const index = args.indexOf('model_reasoning_effort="high"');
        expect(index).toBeGreaterThan(0);
        expect(args[index - 1]).toBe('-c');
        await finish();
        await pending;
    });

    it('does not override reasoning effort when using the model default', async () => {
        const pending = generate();
        await started();
        expect(args.some((arg) => arg.startsWith('model_reasoning_effort='))).toBe(false);
        await finish();
        await pending;
    });
});

describe('Codex generation logs', () => {
    it('records progress and elapsed time without logging the prompt or generated text', async () => {
        vi.useFakeTimers();
        const info = vi.spyOn(logger, 'info').mockImplementation(() => {});
        const pending = generate('test-model');
        await started();
        child.stdout.write(JSON.stringify({ type: 'turn.started' }) + '\n');
        child.stdout.write(
            JSON.stringify({
                type: 'item.completed',
                item: { type: 'agent_message', text: 'private generated content' },
            }) + '\n'
        );
        await vi.advanceTimersByTimeAsync(15000);
        expect(info).toHaveBeenCalledWith(
            '[codex-cli] waiting',
            expect.objectContaining({ lastEvent: 'item.completed' })
        );
        await finish('private generated content');
        await pending;
        expect(info).toHaveBeenCalledWith('[codex-cli] completed', expect.objectContaining({ outputBytes: 25 }));
        const logs = JSON.stringify(info.mock.calls);
        expect(logs).not.toContain('private generated content');
        expect(logs).not.toContain('literal $(touch unsafe)');
        const count = info.mock.calls.length;
        await vi.advanceTimersByTimeAsync(15000);
        expect(info).toHaveBeenCalledTimes(count);
    });
});
