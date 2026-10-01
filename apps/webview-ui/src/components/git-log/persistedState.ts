import type { BranchListData, LogCommit } from '@shared/messages';

export interface GitLogPersistedStateSchema {
    'gitLog.branchListData': BranchListData;
    'branchList.expandedIds': Set<string>;
    'branchList.selectedId': string | null;
    'branchList.filterText': string;
    'branchList.scrollTop': number;
    'gitLog.filter.branch': string;
    'gitLog.filter.search': string;
    'gitLog.filter.regexMode': boolean;
    'gitLog.filter.caseSensitive': boolean;
    'gitLog.filter.authors': string[];
    'gitLog.filter.paths': string[];
    'gitLog.filter.since': string | undefined;
    'gitLog.filter.until': string | undefined;
    'gitLog.commits': LogCommit[];
    'gitLog.scrollTop': number;
    'gitLog.selectedHashes': string[];
    'gitLog.branchSplitRatio': number;
    'gitLog.detailsSplitRatio': number;
    'gitLog.commitDetailsSplitRatio': number;
}

export const gitLogStateDefaults: GitLogPersistedStateSchema = {
    'gitLog.branchListData': {
        hasRepository: true,
        currentBranch: '',
        localBranches: [],
        localBranchesInfo: [],
        remoteBranches: {},
        tags: [],
    },
    'branchList.expandedIds': new Set(['local']),
    'branchList.selectedId': null,
    'branchList.filterText': '',
    'branchList.scrollTop': 0,
    'gitLog.filter.branch': 'all',
    'gitLog.filter.search': '',
    'gitLog.filter.regexMode': false,
    'gitLog.filter.caseSensitive': false,
    'gitLog.filter.authors': [],
    'gitLog.filter.paths': [],
    'gitLog.filter.since': undefined,
    'gitLog.filter.until': undefined,
    'gitLog.commits': [],
    'gitLog.scrollTop': 0,
    'gitLog.selectedHashes': [],
    'gitLog.branchSplitRatio': 0.2,
    'gitLog.detailsSplitRatio': 0.7,
    'gitLog.commitDetailsSplitRatio': 0.6,
};
