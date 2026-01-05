import { SplitPane } from '../common/SplitPane';
import { BranchListPanel } from './BranchListPanel';

import { LogListPanel } from './LogListPanel';

import { useState, useCallback } from 'react';
import { CommitDetailsPanel } from './CommitDetailsPanel';

export function GitLogView() {
    const [selectedCommits, setSelectedCommits] = useState<string[]>([]);
    const [branchFilter, setBranchFilter] = useState<string | undefined>(undefined);
    const selectedHash = selectedCommits.length > 0 ? selectedCommits[0] : null;

    const handleBranchDoubleClick = useCallback((branch: string) => {
        setBranchFilter(branch);
    }, []);

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
                        first={<LogListPanel onSelectionChange={setSelectedCommits} externalBranchFilter={branchFilter} />}
                        second={<CommitDetailsPanel commitHash={selectedHash} />}
                    />
                }
            />
        </div>
    );
}
