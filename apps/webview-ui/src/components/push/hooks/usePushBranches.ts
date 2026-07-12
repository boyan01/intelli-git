import { useState, useEffect, useCallback, useMemo } from 'react';
import { rpc } from '@/lib/rpc_client';
import { usePersistedState } from '../../../hooks/usePersistedState';
import { useRpcData } from '@/hooks/useRpcData';
import { resolvePushTarget } from '../pushTarget';
import type { RefreshScope } from '@shared/messages';

const PUSH_REFRESH_SCOPES: RefreshScope[] = ['push'];

export function usePushBranches(enabled = true) {
    const loadPushInitState = useCallback(async () => await rpc.getPushInitState(), []);

    // 1. Load Initial State (Local branch & Remotes)
    const {
        data: initState,
        loading: isInitStateLoading
    } = useRpcData(
        loadPushInitState,
        {
            initialValue: { repositoryPath: '', localBranch: '', remotes: [], protectedPushTargets: [] },
            enabled,
            refreshScopes: PUSH_REFRESH_SCOPES,
            cacheKey: 'push.initState'
        }
    );

    // 2. State for User Selection
    const [selectedRemoteOverride, setSelectedRemoteOverride] = useState<string>('');
    const [selectedRemoteBranchOverride, setSelectedRemoteBranchOverride] = useState<string>('');
    const [manualTargetConfirmed, setManualTargetConfirmed] = useState(false);

    // 3. Persisted State
    const [savedSelection, setSavedSelection] = usePersistedState('push.branchSelection');

    // 4. Reset overrides when local branch changes
    useEffect(() => {
        setSelectedRemoteOverride('');
        setSelectedRemoteBranchOverride('');
        setManualTargetConfirmed(false);
    }, [initState.localBranch, initState.repositoryPath]);


    const defaultSelection = useMemo(() => resolvePushTarget(
        initState,
        savedSelection,
        {
            remote: selectedRemoteOverride || undefined,
            remoteBranch: selectedRemoteBranchOverride || undefined,
            confirmed: manualTargetConfirmed
        }
    ), [initState, savedSelection, selectedRemoteOverride, selectedRemoteBranchOverride, manualTargetConfirmed]);

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
            enabled,
            refreshScopes: PUSH_REFRESH_SCOPES,
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

    const isPushTargetConfirmed = useMemo(() => {
        if (!selectedRemote || !selectedRemoteBranch) {
            return false;
        }
        if (defaultSelection.confirmation === 'unconfirmed') {
            return false;
        }
        if (defaultSelection.remote !== selectedRemote) {
            return false;
        }
        if (defaultSelection.remoteBranch !== selectedRemoteBranch) {
            return false;
        }
        return true;
    }, [defaultSelection, selectedRemote, selectedRemoteBranch]);

    const isProtectedPushTarget = useMemo(() => {
        if (!selectedRemote || !selectedRemoteBranch) {
            return false;
        }

        return (initState.protectedPushTargets ?? []).includes(`${selectedRemote}/${selectedRemoteBranch}`);
    }, [initState.protectedPushTargets, selectedRemote, selectedRemoteBranch]);

    const persistSelection = useCallback((remote: string, remoteBranch: string, confirmed: boolean) => {
        if (initState.localBranch && remote && remoteBranch) {
            setSavedSelection({
                repositoryPath: initState.repositoryPath,
                localBranch: initState.localBranch,
                remote,
                remoteBranch,
                confirmed
            });
        }
    }, [initState.localBranch, initState.repositoryPath, setSavedSelection]);

    const confirmSelectedTarget = useCallback(() => {
        if (!selectedRemote || !selectedRemoteBranch) {
            return;
        }

        setManualTargetConfirmed(true);
        persistSelection(selectedRemote, selectedRemoteBranch, true);
    }, [persistSelection, selectedRemote, selectedRemoteBranch]);

    const handleSelectedRemoteChange = useCallback((remote: string) => {
        setSelectedRemoteOverride(remote);
        setManualTargetConfirmed(true);
        persistSelection(remote, selectedRemoteBranch || initState.localBranch, true);
    }, [initState.localBranch, persistSelection, selectedRemoteBranch]);

    const handleSelectedRemoteBranchChange = useCallback((remoteBranch: string) => {
        setSelectedRemoteBranchOverride(remoteBranch);
        setManualTargetConfirmed(true);
        persistSelection(selectedRemote, remoteBranch, true);
    }, [persistSelection, selectedRemote]);

    return {
        repositoryPath: initState.repositoryPath,
        localBranch: initState.localBranch,
        remotes: initState.remotes,
        remoteBranches,
        selectedRemote,
        setSelectedRemote: handleSelectedRemoteChange,
        selectedRemoteBranch,
        setSelectedRemoteBranch: handleSelectedRemoteBranchChange,
        pushTarget: selectedRemote && selectedRemoteBranch
            ? {
                remote: selectedRemote,
                branch: selectedRemoteBranch,
                isConfirmed: isPushTargetConfirmed,
                confirmation: defaultSelection.confirmation
            }
            : undefined,
        isProtectedPushTarget,
        confirmSelectedTarget,
        isRemoteBranchesLoading,
        isInitStateLoading,
    };
}
