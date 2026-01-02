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

export type RpcSchema = any; // Allow interfaces to be used as schema

export class RpcPeer<T extends RpcSchema = any> {
    private pendingRequests = new Map<string, PendingRequest>();
    private handlers = new Map<string, (params: any) => Promise<any> | any>();
    private postMessageTarget: PostMessageImpl;

    constructor(postMessageTarget: PostMessageImpl) {
        this.postMessageTarget = postMessageTarget;
    }

    /**
     * Call a remote method.
     */
    public call<K extends keyof T & string>(method: K, params?: T[K] extends (...args: infer P) => any ? P[0] : never): Promise<T[K] extends (...args: any) => infer R ? Awaited<R> : never> {
        const id = Math.random().toString(36).substring(7);

        return new Promise((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject });

            this.postMessageTarget.postMessage({
                type: 'rpc-request',
                id,
                method,
                params
            });

            // Optional: Timeout
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error(`RPC timeout for method: ${method}`));
                }
            }, 10000);
        });
    }

    /**
     * Register a local method implementation.
     */
    public register<K extends keyof T & string>(method: K, handler: T[K]) {
        this.handlers.set(method, handler as any);
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
