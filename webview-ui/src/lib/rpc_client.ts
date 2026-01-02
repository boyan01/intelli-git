import { RpcPeer } from '@shared/rpc';
import { vscode } from './vscode';
import type { ExtensionMethods } from '@shared/messages';

// Create RpcPeer instance for Webview: call ExtensionMethods, register nothing
const _rpc = new RpcPeer<ExtensionMethods, object>({
    postMessage: (message) => vscode.postMessage(message)
});

export const rpc = _rpc.proxy;

// Listen for incoming messages from Extension
window.addEventListener('message', (event) => {
    const message = event.data;
    _rpc.handleMessage(message);
});
