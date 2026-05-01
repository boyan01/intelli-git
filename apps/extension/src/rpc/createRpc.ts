import * as vscode from 'vscode';
import { RpcPeer } from '@shared/rpc';
import type { WebviewMethods, ExtensionMethods } from '@shared/messages';
import { logger } from '../utils/logger';

export interface RpcHelperOptions {
    webview: vscode.Webview;
    onDisposed?: () => boolean;
}

/**
 * Creates and initializes an RpcPeer for a VS Code webview.
 */
export function createRpc(options: RpcHelperOptions): RpcPeer<WebviewMethods, ExtensionMethods> {
    const { webview, onDisposed } = options;

    const rpc = new RpcPeer<WebviewMethods, ExtensionMethods>(
        {
            postMessage: (msg: any) => {
                if (onDisposed && onDisposed()) {
                    return;
                }
                try {
                    webview.postMessage(msg);
                } catch (error) {
                    if (!onDisposed || !onDisposed()) {
                        logger.error('Failed to post message to webview:', error);
                    }
                }
            }
        },
        {
            trace: event => {
                if (event.elapsedMs === undefined) {
                    return;
                }

                const log = event.ok === false ? logger.warn : logger.debug;
                log('[rpc]', event);
            }
        }
    );

    return rpc;
}

/**
 * Helper to handle incoming webview messages for RPC.
 */
export function createRpcMessageHandler(rpc: RpcPeer<any, any>) {
    return (message: any) => {
        if (message.type === 'rpc-request' || message.type === 'rpc-response') {
            rpc.handleMessage(message);
            return true;
        }
        return false;
    };
}
