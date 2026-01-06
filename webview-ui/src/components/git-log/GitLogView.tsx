import { SplitPane } from '../common/SplitPane';
import { BranchListPanel } from './BranchListPanel';
import { LogListPanel } from './LogListPanel';
import { CommitDetailsView } from '../common/CommitDetailsView';

import { useState, useCallback, useEffect } from 'react';
import type { CommitDetails } from '../../../../shared/messages';
import { rpc } from '../../lib/rpc_client';

export function GitLogView() {
    const [selectedHashes, setSelectedHashes] = useState<string[]>([]);
    const [branchFilter, setBranchFilter] = useState<string | undefined>(undefined);
    const [commitDetails, setCommitDetails] = useState<CommitDetails | undefined>(undefined);

    const handleBranchDoubleClick = useCallback((branch: string) => {
        setBranchFilter(branch);
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

    return (
        <div style={{ height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column' }}>
            <SplitPane
                direction="horizontal"
                defaultSize={200}
                minSize={0}
                first={<BranchListPanel onBranchDoubleClick={handleBranchDoubleClick} />}
                second={
                    <SplitPane
                        direction="horizontal"
                        defaultRatio={0.68}
                        minSize={200}
                        first={<LogListPanel onSelectionChange={setSelectedHashes} externalBranchFilter={branchFilter} />}
                        second={
                            <CommitDetailsView
                                selectedHashes={selectedHashes}
                                commit={commitDetails}
                                showBranches={true}
                            />
                        }
                    />
                }
            />
        </div>
    );
}
