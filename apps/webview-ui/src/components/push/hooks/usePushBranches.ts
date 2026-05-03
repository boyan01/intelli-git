import { useState, useEffect, useCallback, useMemo } from 'react';
import { rpc } from '@/lib/rpc_client';
import { usePersistedState } from '../../../hooks/usePersistedState';
import { useRpcData } from '@/hooks/useRpcData';

export function usePushBranches() {
    const loadPushInitState = useCallback(async () => await rpc.getPushInitState(), []);

    // 1. Load Initial State (Local branch & Remotes)
    const {
        data: initState,
        loading: isInitStateLoading
    } = useRpcData(
        loadPushInitState,
        {
            initialValue: { localBranch: '', remotes: [] },
            refreshOnEvent: true,
            cacheKey: 'push.initState'
        }
    );

    // 2. State for User Selection
    const [selectedRemoteOverride, setSelectedRemoteOverride] = useState<string>('');
    const [selectedRemoteBranchOverride, setSelectedRemoteBranchOverride] = useState<string>('');

    // 3. Persisted State
    const [savedSelection, setSavedSelection] = usePersistedState('push.branchSelection');

    // 4. Reset overrides when local branch changes
    useEffect(() => {
        setSelectedRemoteOverride('');
        setSelectedRemoteBranchOverride('');
    }, [initState.localBranch]);


    const defaultSelection = useMemo(() => {
        if (!initState.localBranch) {
            return { remote: '', remoteBranch: '' };
        }

        const { localBranch, remotes, upstream } = initState;
        const saved = savedSelection;

        let remote = '';
        let remoteBranch = '';

        if (saved.localBranch === localBranch) {
            if (saved.remote && remotes.includes(saved.remote)) {
                remote = saved.remote;
            }
            if (saved.remoteBranch) {
                remoteBranch = saved.remoteBranch;
            }
        }

        if (!remote && upstream) {
            const parts = upstream.split('/');
            if (parts.length > 1) {
                const upstreamRemote = parts[0];
                if (remotes.includes(upstreamRemote)) {
                    remote = upstreamRemote;
                    remoteBranch = parts.slice(1).join('/');
                }
            }
        }

        if (!remote) {
            remote = remotes[0] || 'origin';
        }

        if (!remoteBranch) {
            remoteBranch = localBranch;
        }

        return { remote, remoteBranch };
    }, [initState, savedSelection]);

    const selectedRemote = selectedRemoteOverride || defaultSelection.remote;


    // 5. Load Remote Branches based on selection
    const loadRemoteBranches = useCallback(async () => {
        if (!selectedRemote) {
            return { remote: '', branches: [] };
        }
        return {
            remote: selectedRemote,
            branches: await rpc.getRemoteBranches(selectedRemote)
        };
    }, [selectedRemote]);

    const {
        data: remoteBranchState,
    } = useRpcData(
        loadRemoteBranches,
        {
            initialValue: { remote: '', branches: [] },
            cacheKey: 'push.remoteBranches'
        }
    );

    const hasRemoteBranchSnapshot = remoteBranchState.remote === selectedRemote;
    const remoteBranches = useMemo(
        () => hasRemoteBranchSnapshot ? remoteBranchState.branches : [],
        [hasRemoteBranchSnapshot, remoteBranchState.branches]
    );
    const isRemoteBranchesLoading = selectedRemote !== '' && !hasRemoteBranchSnapshot;

    const selectedRemoteBranch = useMemo(() => {
        if (selectedRemoteBranchOverride) {
            return selectedRemoteBranchOverride;
        }

        const candidate = defaultSelection.remoteBranch;

        if (!selectedRemote) {
            return candidate;
        }

        if (!candidate || remoteBranches.length === 0 || remoteBranches.includes(candidate)) {
            return candidate;
        }

        if (candidate === initState.localBranch) {
            return candidate;
        }

        if (initState.localBranch && remoteBranches.includes(initState.localBranch)) {
            return initState.localBranch;
        }

        return remoteBranches[0] || candidate;
    }, [selectedRemoteBranchOverride, defaultSelection.remoteBranch, selectedRemote, remoteBranches, initState.localBranch]);


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

    const handleSelectedRemoteChange = useCallback((remote: string) => {
        setSelectedRemoteOverride(remote);
    }, []);

    const handleSelectedRemoteBranchChange = useCallback((remoteBranch: string) => {
        setSelectedRemoteBranchOverride(remoteBranch);
    }, []);

    return {
        localBranch: initState.localBranch,
        remotes: initState.remotes,
        remoteBranches,
        selectedRemote,
        setSelectedRemote: handleSelectedRemoteChange,
        selectedRemoteBranch,
        setSelectedRemoteBranch: handleSelectedRemoteBranchChange,
        isRemoteBranchesLoading,
        isInitStateLoading,
    };
}
