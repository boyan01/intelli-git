import { describe, expect, it } from 'vitest';
import { RpcError } from '@shared/rpc';
import { describePushError, PUSH_REJECTED_BEHIND_CODE } from './pushError';

describe('describePushError', () => {
    it('marks structured behind rejection errors as pullable', () => {
        expect(describePushError(new RpcError(
            'Push rejected because the remote branch has new commits.',
            PUSH_REJECTED_BEHIND_CODE,
            { behind: 3 }
        ))).toEqual({
            kind: 'behind',
            message: 'Push rejected because the remote branch has new commits.',
            canPull: true,
            behindCount: 3
        });
    });

    it('treats plain messages as generic push errors', () => {
        expect(describePushError(new Error('remote rejected'))).toEqual({
            kind: 'generic',
            message: 'remote rejected',
            canPull: false
        });
    });
});
