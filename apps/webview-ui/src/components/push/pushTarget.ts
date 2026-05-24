import type { PushInitState } from '@shared/messages';

export type PushTargetConfirmation = 'upstream' | 'saved' | 'manual' | 'unconfirmed';

export interface SavedPushBranchSelection {
    repositoryPath?: string;
    localBranch: string;
    remote: string;
    remoteBranch: string;
    confirmed?: boolean;
}

export interface PushBranchSelectionOverride {
    remote?: string;
    remoteBranch?: string;
    confirmed?: boolean;
}

export interface ResolvedPushTarget {
    remote: string;
    remoteBranch: string;
    confirmation: PushTargetConfirmation;
}

function parseUpstream(upstream: string | undefined, remotes: string[]): Pick<ResolvedPushTarget, 'remote' | 'remoteBranch'> | undefined {
    if (!upstream) {
        return undefined;
    }

    const parts = upstream.split('/');
    if (parts.length < 2) {
        return undefined;
    }

    const remote = parts[0];
    if (!remotes.includes(remote)) {
        return undefined;
    }

    return {
        remote,
        remoteBranch: parts.slice(1).join('/')
    };
}

function isSavedSelectionForState(saved: SavedPushBranchSelection, initState: PushInitState): boolean {
    if (!initState.localBranch || saved.localBranch !== initState.localBranch) {
        return false;
    }

    if (initState.repositoryPath && saved.repositoryPath !== initState.repositoryPath) {
        return false;
    }

    return true;
}

export function resolvePushTarget(
    initState: PushInitState,
    savedSelection: SavedPushBranchSelection,
    override: PushBranchSelectionOverride = {}
): ResolvedPushTarget {
    if (!initState.localBranch) {
        return {
            remote: '',
            remoteBranch: '',
            confirmation: 'unconfirmed'
        };
    }

    const remotes = initState.remotes;
    const upstreamTarget = parseUpstream(initState.upstream, remotes);
    const savedMatchesState = isSavedSelectionForState(savedSelection, initState);
    const savedMatchesRemote = savedSelection.remote !== '' && remotes.includes(savedSelection.remote);
    const savedMatchesBranch = savedSelection.remoteBranch !== '';
    const savedTarget = savedMatchesState && savedMatchesRemote && savedMatchesBranch
        ? savedSelection
        : undefined;

    let remote: string;
    let remoteBranch: string;
    let confirmation: PushTargetConfirmation = 'unconfirmed';

    if (savedTarget?.confirmed) {
        remote = savedTarget.remote;
        remoteBranch = savedTarget.remoteBranch;
        confirmation = 'saved';
    } else if (upstreamTarget) {
        remote = upstreamTarget.remote;
        remoteBranch = upstreamTarget.remoteBranch;
        confirmation = 'upstream';
    } else if (savedTarget) {
        remote = savedTarget.remote;
        remoteBranch = savedTarget.remoteBranch;
    } else {
        remote = remotes[0] || 'origin';
        remoteBranch = initState.localBranch;
    }

    if (override.remote) {
        remote = override.remote;
    }
    if (override.remoteBranch) {
        remoteBranch = override.remoteBranch;
    }
    if (override.confirmed) {
        confirmation = 'manual';
    }

    return {
        remote,
        remoteBranch,
        confirmation
    };
}
