import type { PushFailedResult, PushFailureCode } from '@shared/messages';

export interface PushErrorDescriptor {
    kind: PushFailureCode;
    message: string;
    canPull: boolean;
    behindCount?: number;
}

export function describePushFailure(result: PushFailedResult): PushErrorDescriptor {
    return {
        kind: result.code,
        message: result.message,
        canPull: result.code === 'behind',
        behindCount: result.behindCount
    };
}

export function describeUnknownPushError(error: unknown): PushErrorDescriptor {
    return {
        kind: 'unknown',
        message: error instanceof Error ? error.message : String(error),
        canPull: false
    };
}
