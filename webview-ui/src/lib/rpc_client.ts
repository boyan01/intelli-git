import { RpcPeer } from '@shared/rpc';
import { vscode } from './vscode';
import type { ExtensionMethods, WebviewMethods } from '@shared/messages';

type Listener<T> = (data: T) => void;

class EventStream<T> {
    private listeners: Set<Listener<T>> = new Set();

    subscribe(listener: Listener<T>): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    emit(data: T) {
        this.listeners.forEach(listener => listener(data));
    }
}

export const rpcEvents = {
    activeFileChange: new EventStream<{ path: string; commitHash?: string }>(),
    refresh: new EventStream<void>(),
};

const _rpc = new RpcPeer<ExtensionMethods, WebviewMethods>({
    postMessage: (message) => vscode.postMessage(message)
});

export const rpc = _rpc.proxy;

_rpc.registerAll({
    activeFileChange: (params) => rpcEvents.activeFileChange.emit(params),
    refresh: () => rpcEvents.refresh.emit(),
});

window.addEventListener('message', (event) => {
    const message = event.data;
    _rpc.handleMessage(message);
});
