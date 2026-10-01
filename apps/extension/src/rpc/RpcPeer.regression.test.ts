import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { RpcError, RpcPeer } from '@shared/rpc';

test('RpcPeer sends zero-argument calls without an empty array payload', async () => {
    let receivedParams: unknown = 'unset';
    let client!: RpcPeer<{ createChangelist: () => Promise<void> }>;
    let server!: RpcPeer<unknown, { createChangelist: () => Promise<void> }>;

    client = new RpcPeer({
        postMessage: (message) => {
            server.handleMessage(message);
        },
    });

    server = new RpcPeer({
        postMessage: (message) => {
            client.handleMessage(message);
        },
    });

    server.registerAll({
        createChangelist: (params?: unknown) => {
            receivedParams = params;
            return Promise.resolve();
        },
    });

    await client.proxy.createChangelist();

    assert.equal(receivedParams, undefined);
});

test('RpcPeer preserves structured error codes and data', async () => {
    let client!: RpcPeer<{ push: () => Promise<void> }>;
    let server!: RpcPeer<unknown, { push: () => Promise<void> }>;

    client = new RpcPeer({
        postMessage: (message) => {
            server.handleMessage(message);
        },
    });

    server = new RpcPeer({
        postMessage: (message) => {
            client.handleMessage(message);
        },
    });

    server.registerAll({
        push: () => {
            const error = new Error('Push rejected because the remote branch has new commits.');
            throw Object.assign(error, {
                code: 'PUSH_REJECTED_BEHIND',
                data: { behind: 2 },
            });
        },
    });

    await assert.rejects(
        () => client.proxy.push(),
        (error) => {
            assert.ok(error instanceof RpcError);
            assert.equal(error.code, 'PUSH_REJECTED_BEHIND');
            assert.deepEqual(error.data, { behind: 2 });
            return true;
        }
    );
});
