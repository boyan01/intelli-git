import { RpcError } from '@shared/rpc';

export const PUSH_REJECTED_BEHIND_CODE = 'PUSH_REJECTED_BEHIND';

export interface PushErrorDescriptor {
    kind: 'behind' | 'generic';
    message: string;
    canPull: boolean;
    behindCount?: number;
}

function getErrorCode(error: unknown): string | undefined {
    if (error instanceof RpcError) {
        return error.code;
    }
    if (typeof error === 'object' && error !== null && 'code' in error) {
        const code = (error as { code?: unknown }).code;
        return typeof code === 'string' ? code : undefined;
    }
    return undefined;
}

function getBehindCount(error: unknown): number {
    const data = error instanceof RpcError
        ? error.data
        : typeof error === 'object' && error !== null && 'data' in error
            ? (error as { data?: unknown }).data
            : undefined;

    if (typeof data === 'object' && data !== null && 'behind' in data) {
        const behind = Number((data as { behind?: unknown }).behind);
        return Number.isFinite(behind) && behind > 0 ? behind : 0;
    }

    return 0;
}

export function describePushError(error: unknown): PushErrorDescriptor {
    if (getErrorCode(error) === PUSH_REJECTED_BEHIND_CODE) {
        return {
            kind: 'behind',
            message: error instanceof Error ? error.message : String(error),
            canPull: true,
            behindCount: getBehindCount(error)
        };
    }

    return {
        kind: 'generic',
        message: error instanceof Error ? error.message : String(error),
        canPull: false
    };
}
