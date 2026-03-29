import { SplitPane } from '../common/SplitPane';
import { BranchListPanel } from './BranchListPanel';
import { LogListPanel } from './LogListPanel';
import { CommitDetailsView } from '../common/CommitDetailsView';
import styles from './GitLogView.module.css';

import { useState, useCallback, useEffect, useRef } from 'react';
import type { CommitDetails } from '@shared/messages';
import { rpc } from '../../lib/rpc_client';
import { usePersistedState } from '../../hooks/usePersistedState';

const NARROW_THRESHOLD = 800;

export function GitLogView() {
    const containerRef = useRef<HTMLDivElement>(null);
    const [selectedHashes, setSelectedHashes] = useState<string[]>([]);
    const [branchFilter, setBranchFilter] = useState<string | undefined>(undefined);
    const [commitDetails, setCommitDetails] = useState<CommitDetails | undefined>(undefined);
    const [isNarrowMode, setIsNarrowMode] = useState(false);

    const [branchSplitRatio, setBranchSplitRatio] = usePersistedState('gitLog.branchSplitRatio');
    const [detailsSplitRatio, setDetailsSplitRatio] = usePersistedState('gitLog.detailsSplitRatio');

    const handleBranchDoubleClick = useCallback((branch: string) => {
        setBranchFilter(branch);
    }, []);

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

    useEffect(() => {
        if (selectedHashes.length === 1) {
            rpc.getCommitDetails(selectedHashes[0])
                .then(setCommitDetails)
                .catch(() => setCommitDetails(undefined));
        } else {
            setCommitDetails(undefined);
        }
    }, [selectedHashes]);

    const logListPanel = (
        <LogListPanel
            onSelectionChange={setSelectedHashes}
            externalBranchFilter={branchFilter}
            isNarrowMode={isNarrowMode}
            selectedHashes={selectedHashes}
            commitDetails={commitDetails}
        />
    );

    const commitDetailsPanel = (
        <CommitDetailsView
            selectedHashes={selectedHashes}
            commit={commitDetails}
            showBranches={true}
        />
    );

    return (
        <div ref={containerRef} className={styles.container}>
            <SplitPane
                direction="horizontal"
                defaultSize={200}
                minSize={0}
                ratio={branchSplitRatio}
                onRatioChange={setBranchSplitRatio}
                first={<BranchListPanel onBranchDoubleClick={handleBranchDoubleClick} />}
                second={
                    isNarrowMode ? (
                        logListPanel
                    ) : (
                        <SplitPane
                            direction="horizontal"
                            defaultRatio={0.68}
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
