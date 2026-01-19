import { useState, useEffect } from 'react';
import { rpc } from '@/lib/rpc_client';
import { usePersistedState } from '../../../hooks/usePersistedState';
import { useRpcData } from '@/hooks/useRpcData';

export function usePushBranches() {
    // 1. Load Initial State (Local branch & Remotes)
    const { data: initState } = useRpcData(
        async () => await rpc.getPushInitState(),
        {
            initialValue: { localBranch: '', remotes: [] },
            refreshOnEvent: true
        }
    );

    // 2. State for User Selection
    const [selectedRemote, setSelectedRemote] = useState<string>('');
    const [selectedRemoteBranch, setSelectedRemoteBranch] = useState<string>('');

    // 3. Persisted State
    const [savedSelection, setSavedSelection] = usePersistedState('push.branchSelection');


    // 4. Initialize Selection when initState loads
    useEffect(() => {
        if (!initState.localBranch) return; // Not loaded yet

        const { localBranch, remotes, upstream } = initState;
        const saved = savedSelection;

        // Determine Remote & Remote Branch
        let newRemote = '';
        let newRemoteBranch = '';

        if (saved.localBranch === localBranch) {
            // Same local branch: try to respect saved choice if valid
            if (saved.remote && remotes.includes(saved.remote)) {
                newRemote = saved.remote;
            }
            if (saved.remoteBranch) {
                newRemoteBranch = saved.remoteBranch;
            }
        }

        // If no valid saved selection, fall back to defaults (upstream or intelligent guess)
        if (!newRemote) {
            // Try to deduce from upstream
            if (upstream) {
                // upstream format: "origin/branch-name"
                const parts = upstream.split('/');
                if (parts.length > 1) {
                    const upstreamRemote = parts[0];
                    if (remotes.includes(upstreamRemote)) {
                        newRemote = upstreamRemote;
                        newRemoteBranch = parts.slice(1).join('/');
                    }
                }
            }

            // If still no remote, default to first available
            if (!newRemote) {
                newRemote = remotes[0] || 'origin';
            }
        }

        // If no remote branch yet (and didn't get from upstream)
        if (!newRemoteBranch) {
            newRemoteBranch = localBranch; // Default to matching name
        }

        setSelectedRemote(newRemote);
        setSelectedRemoteBranch(newRemoteBranch);

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initState.localBranch, JSON.stringify(initState.remotes), initState.upstream]); // Run when localBranch, remotes or upstream changes


    // 5. Load Remote Branches based on selection
    const {
        data: remoteBranches,
        loading: isRemoteBranchesLoading,
    } = useRpcData(
        async () => {
            if (!selectedRemote) return [];
            return await rpc.getRemoteBranches(selectedRemote);
        },
        {
            initialValue: [],
            deps: [selectedRemote]
        }
    );

    // 6. Auto-select remote branch if current selection is invalid for the new remote
    //    Or if we just switched remote and need a default
    useEffect(() => {
        if (!selectedRemote) return;

        // If we have no remote branches yet, we can't really "validate", but we can stick to defaults.
        // If we do have branches, we check validity.

        // If current selection is NOT in the new list
        if (selectedRemoteBranch && remoteBranches.length > 0 && !remoteBranches.includes(selectedRemoteBranch)) {
            // Special Case: If the selected branch is explicitly the current local branch,
            // we ALLOW it even if it's not on remote (this implies pushing a new branch).
            if (selectedRemoteBranch === initState.localBranch) {
                return;
            }

            // Otherwise, try to find a best match from what exists
            if (initState.localBranch && remoteBranches.includes(initState.localBranch)) {
                setSelectedRemoteBranch(initState.localBranch);
            } else {
                // Fallback to first available
                setSelectedRemoteBranch(remoteBranches[0]);
            }
        }
    }, [remoteBranches, selectedRemote, initState.localBranch, selectedRemoteBranch]);


    // 7. Save Selection Persistence
    useEffect(() => {
        if (initState.localBranch && selectedRemote && selectedRemoteBranch) {
            setSavedSelection({
                localBranch: initState.localBranch,
                remote: selectedRemote,
                remoteBranch: selectedRemoteBranch
            });
        }
    }, [initState.localBranch, selectedRemote, selectedRemoteBranch, setSavedSelection]);

    return {
        localBranch: initState.localBranch,
        remotes: initState.remotes,
        remoteBranches,
        selectedRemote,
        setSelectedRemote,
        selectedRemoteBranch,
        setSelectedRemoteBranch,
        isRemoteBranchesLoading,
    };
}
