import { SplitPane } from '../common/SplitPane';
import { BranchListPanel } from './BranchListPanel';
import { LogListPanel } from './LogListPanel';
import { CommitDetailsView } from '../common/CommitDetailsView';
import { useVersionCheck } from '../../hooks/useVersionCheck';
import { VersionExpiredPanel } from '../common/VersionExpiredPanel';
import styles from './GitLogView.module.css';

import { useState, useCallback, useEffect, useRef } from 'react';
import { rpc, rpcEvents } from '../../lib/rpc_client';
import { usePersistedState } from '../../hooks/usePersistedState';
import { useRpcData } from '../../hooks/useRpcData';

const NARROW_THRESHOLD = 800;

interface BranchFilterRequest {
    branch: string;
    requestId: number;
}

export function GitLogView() {
    const containerRef = useRef<HTMLDivElement>(null);
    const [selectedHashes, setSelectedHashes] = useState<string[]>([]);
    const [branchFilter, setBranchFilter] = useState<BranchFilterRequest | undefined>(undefined);
    const [isNarrowMode, setIsNarrowMode] = useState(false);

    const [branchSplitRatio, setBranchSplitRatio] = usePersistedState('gitLog.branchSplitRatio');
    const [detailsSplitRatio, setDetailsSplitRatio] = usePersistedState('gitLog.detailsSplitRatio');
    const [commitDetailsSplitRatio, setCommitDetailsSplitRatio] = usePersistedState('gitLog.commitDetailsSplitRatio');

    const handleBranchFilter = useCallback((branch: string) => {
        setBranchFilter(previous => ({
            branch,
            requestId: (previous?.requestId ?? 0) + 1
        }));
    }, []);

    useEffect(() => {
        return rpcEvents.filterLogByBranch.subscribe(({ branch }) => {
            handleBranchFilter(branch);
        });
    }, [handleBranchFilter]);

    const loadCommitDetails = useCallback(() => {
        return selectedHashes.length === 1 ? rpc.getCommitDetails(selectedHashes[0]) : Promise.resolve(undefined);
    }, [selectedHashes]);

    const { data: commitDetails } = useRpcData(
        loadCommitDetails,
        {
            initialValue: undefined
        }
    );

    useEffect(() => {
        if (!containerRef.current) return;
        const observer = new ResizeObserver(entries => {
            for (const entry of entries) {
                setIsNarrowMode(entry.contentRect.width < NARROW_THRESHOLD);
            }
        });
        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, []);

    const logListPanel = (
        <LogListPanel
            onSelectionChange={setSelectedHashes}
            externalBranchFilter={branchFilter}
            isNarrowMode={isNarrowMode}
            commitDetails={commitDetails}
        />
    );

    const { isExpired } = useVersionCheck();
    const commitDetailsPanel = isExpired ? <VersionExpiredPanel /> : (
        <CommitDetailsView
            selectedHashes={selectedHashes}
            commit={commitDetails}
            showBranches={true}
            detailsSplitRatio={commitDetailsSplitRatio}
            onDetailsSplitRatioChange={setCommitDetailsSplitRatio}
        />
    );

    return (
        <div ref={containerRef} className={styles.container}>
            <SplitPane
                direction="horizontal"
                defaultRatio={0.2}
                minSize={0}
                ratio={branchSplitRatio}
                onRatioChange={setBranchSplitRatio}
                first={<BranchListPanel onBranchFilter={handleBranchFilter} />}
                second={
                    isNarrowMode ? (
                        logListPanel
                    ) : (
                        <SplitPane
                            direction="horizontal"
                            defaultRatio={0.7}
                            minSize={200}
                            ratio={detailsSplitRatio}
                            onRatioChange={setDetailsSplitRatio}
                            first={logListPanel}
                            second={commitDetailsPanel}
                        />
                    )
                }
            />
        </div>
    );
}
