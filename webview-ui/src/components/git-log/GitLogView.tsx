import { SplitPane } from '../common/SplitPane';
import { BranchListPanel } from './BranchListPanel';

const LogListPanel = () => {
    return (
        <div style={{ height: '100%', padding: '10px', boxSizing: 'border-box' }}>
            <h3>Git Log</h3>
            {/* TODO: Implement Log List */}
            <div>Commit 1</div>
            <div>Commit 2</div>
        </div>
    );
};

const CommitDetailsPanel = () => {
    return (
        <div style={{ height: '100%', padding: '10px', boxSizing: 'border-box' }}>
            <h3>Details</h3>
            {/* TODO: Implement Commit Details */}
            <div>File Changes...</div>
        </div>
    );
};

export function GitLogView() {
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
                        first={<LogListPanel />}
                        second={<CommitDetailsPanel />}
                    />
                }
            />
        </div>
    );
}
