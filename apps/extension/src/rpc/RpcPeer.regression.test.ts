import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { RpcPeer } from '@shared/rpc';

test('RpcPeer sends zero-argument calls without an empty array payload', async () => {
    let receivedParams: unknown = 'unset';
    let client!: RpcPeer<{ createChangelist: () => Promise<void> }>;
    let server!: RpcPeer<unknown, { createChangelist: () => Promise<void> }>;

    client = new RpcPeer(
        {
            postMessage: (message) => {
                server.handleMessage(message);
            }
        }
    );

    server = new RpcPeer(
        {
            postMessage: (message) => {
                client.handleMessage(message);
            }
        }
    );

    server.registerAll({
        createChangelist: (params?: unknown) => {
            receivedParams = params;
            return Promise.resolve();
        }
    });

    await client.proxy.createChangelist();

    assert.equal(receivedParams, undefined);
});
