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
}

export type RpcSchema = { [key: string]: (...args: any[]) => any };

/**
 * Bidirectional RPC peer.
 * @template TRemote - Methods that can be called on the remote side
 * @template TLocal - Methods that can be registered locally
 */
export class RpcPeer<TRemote = any, TLocal = any> {
    private pendingRequests = new Map<string, PendingRequest>();
    private handlers = new Map<string, (params: any) => Promise<any> | any>();
    private postMessageTarget: PostMessageImpl;
    private _proxy: TRemote | null = null;

    constructor(postMessageTarget: PostMessageImpl) {
        this.postMessageTarget = postMessageTarget;
    }

    /**
     * Get a proxy object for direct remote method calls.
     */
    public get proxy(): TRemote {
        if (!this._proxy) {
            this._proxy = new Proxy({}, {
                get: (_target, prop: string) => {
                    return (...args: any[]) => this.call(prop as any, ...args as any);
                }
            }) as TRemote;
        }
        return this._proxy!;
    }

    /**
     * Call a remote method.
     */
    private call<K extends keyof TRemote & string>(
        method: K,
        ...args: TRemote[K] extends () => any
            ? []
            : TRemote[K] extends (arg: infer P) => any
            ? [params: P]
            : never
    ): Promise<TRemote[K] extends (...args: any) => infer R ? Awaited<R> : never> {
        const id = Math.random().toString(36).substring(7);
        const params = args[0];

        return new Promise((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject });

            this.postMessageTarget.postMessage({
                type: 'rpc-request',
                id,
                method,
                params
            });

            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error(`RPC timeout for method: ${method}`));
                }
            }, 10000);
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
        if (!message || typeof message !== 'object') return;

        if (message.type === 'rpc-request') {
            this.handleRequest(message as RpcRequest);
        } else if (message.type === 'rpc-response') {
            this.handleResponse(message as RpcResponse);
        }
    }

    private async handleRequest(message: RpcRequest) {
        const { id, method, params } = message;
        const handler = this.handlers.get(method);

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
        } catch (error: any) {
            this.postMessageTarget.postMessage({
                type: 'rpc-response',
                id,
                error: error.message || String(error)
            });
        }
    }

    private handleResponse(message: RpcResponse) {
        const { id, result, error } = message;
        if (this.pendingRequests.has(id)) {
            const { resolve, reject } = this.pendingRequests.get(id)!;
            this.pendingRequests.delete(id);

            if (error) {
                reject(new Error(error));
            } else {
                resolve(result);
            }
        }
    }
}
