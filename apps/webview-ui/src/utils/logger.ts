import { rpc } from '../lib/rpc_client';

class WebviewLogger {
    info(...data: any[]): void {
        this.sendLog(data, 'info');
    }

    error(...data: any[]): void {
        this.sendLog(data, 'error');
    }

    warn(...data: any[]): void {
        this.sendLog(data, 'warn');
    }

    debug(...data: any[]): void {
        this.sendLog(data, 'debug');
    }

    private sendLog(data: any[], type: 'info' | 'error' | 'warn' | 'debug'): void {
        const message = data.join(' ');
        rpc.log({ message, type }).catch(console.error);

        // Also log to console for webview debugging
        switch (type) {
            case 'error':
                console.error(`[Webview]`, ...data);
                break;
            case 'warn':
                console.warn(`[Webview]`, ...data);
                break;
            case 'debug':
                console.debug(`[Webview]`, ...data);
                break;
            case 'info':
            default:
                console.log(`[Webview]`, ...data);
                break;
        }
    }
}

export const logger = new WebviewLogger();
