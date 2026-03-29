import * as vscode from 'vscode';
import { RpcPeer } from '@shared/rpc';
import type { WebviewMethods, ExtensionMethods } from '@shared/messages';

export interface RpcHelperOptions {
    webview: vscode.Webview;
    onDisposed?: () => boolean;
}

/**
 * Creates and initializes an RpcPeer for a VS Code webview.
 */
export function createRpc(options: RpcHelperOptions): RpcPeer<WebviewMethods, ExtensionMethods> {
    const { webview, onDisposed } = options;

    const rpc = new RpcPeer<WebviewMethods, ExtensionMethods>({
        postMessage: (msg: any) => {
            if (onDisposed && onDisposed()) {
                return;
            }
            try {
                webview.postMessage(msg);
            } catch (error) {
                if (!onDisposed || !onDisposed()) {
                    console.error('Failed to post message to webview:', error);
                }
            }
        }
    });

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
