import { RpcPeer } from '@shared/rpc';
import { vscode } from './vscode';
import type { ExtensionMethods, GitLogRevealRequest, WebviewMethods } from '@shared/messages';

type Listener<T> = (data: T) => void;

export class EventStream<T> {
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
    revealLog: new EventStream<GitLogRevealRequest>(),
    refresh: new EventStream<void>(),
    clearGitLogFilters: new EventStream<'all' | 'branch'>(),
    switchTab: new EventStream<'commit' | 'stash' | 'push'>(),
};

const _rpc = new RpcPeer<ExtensionMethods, WebviewMethods>(
    {
        postMessage: (message) => vscode.postMessage(message)
    },
    {
        trace: event => {
            if (event.elapsedMs === undefined) {
                return;
            }

            const log = event.ok === false ? console.warn : console.debug;
            log('[Intelli Git RPC]', event);
        }
    }
);

export const rpc = _rpc.proxy;

_rpc.registerAll({
    activeFileChange: (params) => rpcEvents.activeFileChange.emit(params),
    revealLog: (params) => rpcEvents.revealLog.emit(params),
    refresh: () => rpcEvents.refresh.emit(),
    switchTab: (tab) => rpcEvents.switchTab.emit(tab),
});

window.addEventListener('message', (event) => {
    const message = event.data;
    _rpc.handleMessage(message);
});
