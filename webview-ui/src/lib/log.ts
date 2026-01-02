import { rpc } from './rpc_client';

export const logger = {
    log: (...args: any[]) => {
        // Also log to webview console for redundancy/direct checking
        console.log(...args);
        rpc.log(args.map(arg =>
            typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' '));
    },

    info: (...args: any[]) => {
        console.info(...args);
    }
};
