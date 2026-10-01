import { describe, expect, it } from 'vitest';
import { describePushFailure, describeUnknownPushError } from './pushError';

describe('push error descriptors', () => {
    it('marks structured behind results as pullable', () => {
        expect(
            describePushFailure({
                ok: false,
                code: 'behind',
                remote: 'origin',
                branch: 'main',
                message: 'Push rejected because the remote branch has new commits.',
                behindCount: 3,
            })
        ).toEqual({
            kind: 'behind',
            message: 'Push rejected because the remote branch has new commits.',
            canPull: true,
            behindCount: 3,
        });
    });

    it('keeps known non-behind codes non-pullable', () => {
        const cases = [
            ['auth-failed', 'Authentication failed'],
            ['network', 'Could not resolve host'],
            ['rejected', 'pre-receive hook declined'],
            ['unknown', 'unexpected push failure'],
        ] as const;

        for (const [code, message] of cases) {
            expect(
                describePushFailure({
                    ok: false,
                    code,
                    remote: 'origin',
                    branch: 'main',
                    message,
                })
            ).toEqual({
                kind: code,
                message,
                canPull: false,
                behindCount: undefined,
            });
        }
    });

    it('treats thrown push errors as unknown fallback details', () => {
        expect(describeUnknownPushError(new Error('remote rejected'))).toEqual({
            kind: 'unknown',
            message: 'remote rejected',
            canPull: false,
        });
    });
});
