import { SplitPane } from '../common/SplitPane';
import { BranchListPanel } from './BranchListPanel';

import { LogListPanel } from './LogListPanel';

import { useState } from 'react';
import { CommitDetailsPanel } from './CommitDetailsPanel';

// ... (remove old dummy component)

export function GitLogView() {
    const [selectedCommits, setSelectedCommits] = useState<string[]>([]);
    const selectedHash = selectedCommits.length > 0 ? selectedCommits[0] : null;

    return (
        <div style={{ height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column' }}>
            <SplitPane
                direction="horizontal"
                defaultSize={250}
                minSize={150}
                first={<BranchListPanel />}
                second={
                    <SplitPane
                        direction="horizontal"
                        defaultRatio={0.6}
                        minSize={200}
                        first={<LogListPanel onSelectionChange={setSelectedCommits} />}
                        second={<CommitDetailsPanel commitHash={selectedHash} />}
                    />
                }
            />
        </div>
    );
}
