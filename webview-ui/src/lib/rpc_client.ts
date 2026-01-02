import { RpcPeer } from '@shared/rpc';
import { vscode } from './vscode';
import type { ExtensionMethods, WebviewMethods } from '@shared/messages';

// Create RpcPeer instance for Webview
export const rpc = new RpcPeer<ExtensionMethods & WebviewMethods>({
    postMessage: (message) => vscode.postMessage(message)
});

// Listen for incoming messages from Extension
window.addEventListener('message', (event) => {
    const message = event.data;
    rpc.handleMessage(message);
});
