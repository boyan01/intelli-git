export interface RpcRequest {
    type: 'rpc-request';
    id: string;
    method: string;
    params?: any;
}

export interface RpcResponse {
    type: 'rpc-response';
    id: string;
    result?: any;
    error?: string;
}

export type RpcMessage = RpcRequest | RpcResponse;

export interface PostMessageImpl {
    postMessage(message: any): void;
}

interface PendingRequest {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
    timeout: ReturnType<typeof setTimeout>;
    method: string;
    startedAt: number;
}

export type RpcSchema = { [key: string]: (...args: any[]) => any };

export interface RpcTraceEvent {
    method: string;
    id: string;
    direction: 'incoming' | 'outgoing';
    elapsedMs?: number;
    ok?: boolean;
    error?: string;
}

export interface RpcPeerOptions {
    trace?: (event: RpcTraceEvent) => void;
}

/**
 * Bidirectional RPC peer.
 * @template TRemote - Methods that can be called on the remote side
 * @template TLocal - Methods that can be registered locally
 */
export class RpcPeer<TRemote = any, TLocal = any> {
    private nextRequestId = 1;
    private pendingRequests = new Map<string, PendingRequest>();
    private handlers = new Map<string, (params: any) => Promise<any> | any>();
    private postMessageTarget: PostMessageImpl;
    private _proxy: TRemote | null = null;

    constructor(postMessageTarget: PostMessageImpl, private readonly options: RpcPeerOptions = {}) {
        this.postMessageTarget = postMessageTarget;
    }

    /**
     * Get a proxy object for direct remote method calls.
     */
    public get proxy(): TRemote {
        if (!this._proxy) {
            this._proxy = new Proxy({}, {
                get: (_target, prop: string) => {
                    return (...args: any[]) => {
                        if (args.length === 1) {
                            return this.call(prop, args[0]);
                        }
                        return this.call(prop, args);
                    };
                }
            }) as TRemote;
        }
        return this._proxy!;
    }

    /**
     * Call a remote method.
     */
    private call(method: string, params?: any): Promise<any> {
        const id = String(this.nextRequestId++);

        return new Promise((resolve, reject) => {
            const startedAt = Date.now();
            const timeout = setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    this.trace({
                        method,
                        id,
                        direction: 'outgoing',
                        elapsedMs: Date.now() - startedAt,
                        ok: false,
                        error: 'timeout'
                    });
                    reject(new Error(`RPC timeout for method: ${method}`));
                }
            }, 60000);

            this.pendingRequests.set(id, { resolve, reject, timeout, method, startedAt });

            this.postMessageTarget.postMessage({
                type: 'rpc-request',
                id,
                method,
                params
            });

            this.trace({ method, id, direction: 'outgoing' });
        });
    }

    /**
     * Register multiple local method implementations at once.
     * Supports both plain objects and class instances (methods on prototype).
     */
    public registerAll(handlers: Required<TLocal>) {
        // Handle instance own properties (arrow function fields)
        for (const [method, handler] of Object.entries(handlers)) {
            if (typeof handler === 'function') {
                this.handlers.set(method, (handler as Function).bind(handlers));
            }
        }

        // Handle prototype methods (regular class methods)
        const proto = Object.getPrototypeOf(handlers);
        if (proto && proto !== Object.prototype) {
            for (const method of Object.getOwnPropertyNames(proto)) {
                if (method === 'constructor') continue;
                const handler = (handlers as any)[method];
                if (typeof handler === 'function') {
                    this.handlers.set(method, handler.bind(handlers));
                }
            }
        }
    }

    /**
     * Process an incoming message.
     */
    public handleMessage(message: any) {
        if (!message || typeof message !== 'object') {
            console.error('Invalid message:', message);
            return;
        }

        if (message.type === 'rpc-request') {
            this.handleRequest(message as RpcRequest);
        } else if (message.type === 'rpc-response') {
            this.handleResponse(message as RpcResponse);
        } else {
            console.error('Unknown message type:', message);
        }
    }

    private async handleRequest(message: RpcRequest) {
        const { id, method, params } = message;
        const handler = this.handlers.get(method);
        const startedAt = Date.now();

        try {
            if (!handler) {
                throw new Error(`Method not found: ${method}`);
            }

            const result = await handler(params);

            this.postMessageTarget.postMessage({
                type: 'rpc-response',
                id,
                result
            });
            this.trace({
                method,
                id,
                direction: 'incoming',
                elapsedMs: Date.now() - startedAt,
                ok: true
            });
        } catch (error: any) {
            const messageText = error.message || String(error);
            this.postMessageTarget.postMessage({
                type: 'rpc-response',
                id,
                error: messageText
            });
            this.trace({
                method,
                id,
                direction: 'incoming',
                elapsedMs: Date.now() - startedAt,
                ok: false,
                error: messageText
            });
        }
    }

    private handleResponse(message: RpcResponse) {
        const { id, result, error } = message;
        if (this.pendingRequests.has(id)) {
            const { resolve, reject, timeout, method, startedAt } = this.pendingRequests.get(id)!;
            this.pendingRequests.delete(id);
            clearTimeout(timeout);

            if (error) {
                this.trace({
                    method,
                    id,
                    direction: 'outgoing',
                    elapsedMs: Date.now() - startedAt,
                    ok: false,
                    error
                });
                reject(new Error(error));
            } else {
                this.trace({
                    method,
                    id,
                    direction: 'outgoing',
                    elapsedMs: Date.now() - startedAt,
                    ok: true
                });
                resolve(result);
            }
        }
    }

    private trace(event: RpcTraceEvent): void {
        this.options.trace?.(event);
    }
}
