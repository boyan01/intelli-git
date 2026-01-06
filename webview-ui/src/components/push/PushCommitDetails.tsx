import type { CommitDetails } from '@shared/messages';
import { CommitDetailsView } from '../common/CommitDetailsView';

export interface PushCommitDetailsProps {
    selectedHashes: string[];
    commit?: CommitDetails;
}

export function PushCommitDetails({ selectedHashes, commit }: PushCommitDetailsProps) {
    return (
        <CommitDetailsView
            selectedHashes={selectedHashes}
            commit={commit}
            showToggleDetails={true}
            showBranches={false}
        />
    );
}
