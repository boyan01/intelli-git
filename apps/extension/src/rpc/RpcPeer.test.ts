import { afterEach, describe, expect, it, vi } from 'vitest';
import { RpcPeer } from '@shared/rpc';
import { AI_GENERATION_TIMEOUT_MS } from '@shared/messages';

afterEach(() => vi.useRealTimers());

describe('RPC method timeouts', () => {
    it('keeps AI generation pending beyond the ordinary RPC deadline', async () => {
        vi.useFakeTimers();
        const postMessage = vi.fn();
        const peer = new RpcPeer<{ generateCommitMessage(): Promise<string> }>({ postMessage }, {
            methodTimeoutsMs: { generateCommitMessage: AI_GENERATION_TIMEOUT_MS + 30000 }
        });
        const completed = vi.fn();
        const pending = peer.proxy.generateCommitMessage().then(completed);
        await vi.advanceTimersByTimeAsync(90000);
        expect(completed).not.toHaveBeenCalled();
        peer.handleMessage({ type: 'rpc-response', id: postMessage.mock.calls[0][0].id, result: 'Generated subject' });
        await pending;
        expect(completed).toHaveBeenCalledWith('Generated subject');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('delivers the provider timeout before the longer RPC deadline', async () => {
        vi.useFakeTimers();
        const postMessage = vi.fn();
        const peer = new RpcPeer<{ generateCommitMessage(): Promise<string> }>({ postMessage }, {
            methodTimeoutsMs: { generateCommitMessage: AI_GENERATION_TIMEOUT_MS + 30000 }
        });
        const pending = peer.proxy.generateCommitMessage();
        const assertion = expect(pending).rejects.toThrow('Codex CLI timed out');
        await vi.advanceTimersByTimeAsync(AI_GENERATION_TIMEOUT_MS);
        peer.handleMessage({ type: 'rpc-response', id: postMessage.mock.calls[0][0].id, error: 'Codex CLI timed out' });
        await assertion;
        expect(vi.getTimerCount()).toBe(0);
    });

    it('still times out unresponsive AI handlers and keeps ordinary calls at 60 seconds', async () => {
        vi.useFakeTimers();
        const peer = new RpcPeer<{ generateCommitMessage(): Promise<void>; getStatus(): Promise<void> }>({ postMessage() {} }, {
            methodTimeoutsMs: { generateCommitMessage: AI_GENERATION_TIMEOUT_MS + 30000 }
        });
        const ai = expect(peer.proxy.generateCommitMessage()).rejects.toThrow('RPC timeout for method: generateCommitMessage');
        const normal = expect(peer.proxy.getStatus()).rejects.toThrow('RPC timeout for method: getStatus');
        await vi.advanceTimersByTimeAsync(60000);
        await normal;
        expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(90000);
        await ai;
        expect(vi.getTimerCount()).toBe(0);
    });
});
