import { describe, expect, it } from 'vitest';
import type { PushInitState } from '@shared/messages';
import type { SavedPushBranchSelection } from './pushTarget';
import { resolvePushTarget } from './pushTarget';

const emptySavedSelection: SavedPushBranchSelection = {
    repositoryPath: '',
    localBranch: '',
    remote: '',
    remoteBranch: '',
};

function createInitState(overrides: Partial<PushInitState> = {}): PushInitState {
    return {
        repositoryPath: '/repo',
        localBranch: 'feature',
        remotes: ['origin', 'fork'],
        ...overrides,
    };
}

describe('resolvePushTarget', () => {
    it('uses the upstream branch as a confirmed target', () => {
        expect(resolvePushTarget(createInitState({ upstream: 'fork/review/feature' }), emptySavedSelection)).toEqual({
            remote: 'fork',
            remoteBranch: 'review/feature',
            confirmation: 'upstream',
        });
    });

    it('uses saved confirmed target only for the same repository and branch', () => {
        expect(
            resolvePushTarget(createInitState(), {
                repositoryPath: '/repo',
                localBranch: 'feature',
                remote: 'fork',
                remoteBranch: 'feature',
                confirmed: true,
            })
        ).toEqual({
            remote: 'fork',
            remoteBranch: 'feature',
            confirmation: 'saved',
        });
    });

    it('does not treat a fallback target as confirmed without upstream or saved confirmation', () => {
        expect(resolvePushTarget(createInitState({ upstream: undefined }), emptySavedSelection)).toEqual({
            remote: 'origin',
            remoteBranch: 'feature',
            confirmation: 'unconfirmed',
        });
    });

    it('prefers upstream over an old unconfirmed saved target', () => {
        expect(
            resolvePushTarget(createInitState({ upstream: 'origin/feature' }), {
                repositoryPath: '/repo',
                localBranch: 'feature',
                remote: 'fork',
                remoteBranch: 'feature',
                confirmed: false,
            })
        ).toEqual({
            remote: 'origin',
            remoteBranch: 'feature',
            confirmation: 'upstream',
        });
    });

    it('ignores saved targets from another repository with the same branch name', () => {
        expect(
            resolvePushTarget(createInitState({ upstream: 'origin/feature' }), {
                repositoryPath: '/other-repo',
                localBranch: 'feature',
                remote: 'fork',
                remoteBranch: 'feature',
                confirmed: true,
            })
        ).toEqual({
            remote: 'origin',
            remoteBranch: 'feature',
            confirmation: 'upstream',
        });
    });

    it('marks explicit overrides as manually confirmed', () => {
        expect(
            resolvePushTarget(createInitState({ upstream: undefined }), emptySavedSelection, {
                remote: 'fork',
                remoteBranch: 'feature',
                confirmed: true,
            })
        ).toEqual({
            remote: 'fork',
            remoteBranch: 'feature',
            confirmation: 'manual',
        });
    });
});
