import { SplitPane } from '../common/SplitPane';
import { BranchListPanel } from './BranchListPanel';
import { LogListPanel } from './LogListPanel';
import { CommitDetailsView } from '../common/CommitDetailsView';
import { LoadingProgressBar } from '../common/LoadingProgressBar';
import styles from './GitLogView.module.css';

import { useState, useCallback, useEffect, useRef } from 'react';
import { rpc, rpcEvents } from '../../lib/rpc_client';
import { usePersistedState } from '../../hooks/usePersistedState';
import { useRpcData } from '../../hooks/useRpcData';
import { useTranslation } from 'react-i18next';
import type { BranchListData, RefreshScope } from '@shared/messages';

const NARROW_THRESHOLD = 800;
const GIT_LOG_REFRESH_SCOPES: RefreshScope[] = ['gitLog'];

const emptyBranchListData: BranchListData = {
    hasRepository: true,
    currentBranch: '',
    localBranches: [],
    localBranchesInfo: [],
    remoteBranches: {},
    tags: []
};

interface BranchFilterRequest {
    branch: string;
    requestId: number;
}

export function GitLogView() {
    const { t } = useTranslation();
    const containerRef = useRef<HTMLDivElement>(null);
    const [selectedHashes, setSelectedHashes] = useState<string[]>([]);
    const [branchFilter, setBranchFilter] = useState<BranchFilterRequest | undefined>(undefined);
    const [isNarrowMode, setIsNarrowMode] = useState(false);
    const loadActiveRepository = useCallback(() => rpc.getActiveRepository(), []);
    const loadBranchListData = useCallback(() => rpc.getBranchListData(), []);
    const {
        data: activeRepositoryPath,
        loading: activeRepositoryLoading,
        reload: reloadActiveRepository
    } = useRpcData(
        loadActiveRepository,
        { initialValue: undefined, loadingOnRefresh: true, refreshScopes: GIT_LOG_REFRESH_SCOPES }
    );
    const { data: branchListData, loading: branchListLoading, reload: reloadBranchList } = useRpcData(
        loadBranchListData,
        { initialValue: emptyBranchListData, loadingOnRefresh: true, refreshScopes: GIT_LOG_REFRESH_SCOPES }
    );

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
            initialValue: undefined,
            refreshOnEvent: false
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

    const handleInitializeRepository = useCallback(async () => {
        await rpc.initializeRepository();
        await Promise.all([
            reloadActiveRepository(),
            reloadBranchList()
        ]);
    }, [reloadActiveRepository, reloadBranchList]);

    const hasRepository = activeRepositoryLoading
        ? branchListData.hasRepository !== false
        : Boolean(activeRepositoryPath) && branchListData.hasRepository !== false;
    const repositoryPath = activeRepositoryPath ?? branchListData.repository?.repoPath;

    useEffect(() => {
        setSelectedHashes([]);
        setBranchFilter(undefined);
    }, [repositoryPath]);

    if (!hasRepository) {
        return (
            <div ref={containerRef} className={styles.container}>
                <div className={styles.statePanel}>
                    <i className={`codicon codicon-source-control ${styles.stateIcon}`} aria-hidden="true" />
                    <div className={styles.stateTitle}>{t('No Git repository found')}</div>
                    <div className={styles.stateDescription}>
                        {t('Open a folder that contains a Git repository, or initialize one in the current workspace.')}
                    </div>
                    <div className={styles.stateActions}>
                        <button
                            className={styles.stateButton}
                            type="button"
                            onClick={() => void rpc.openFolder()}
                        >
                            <i className="codicon codicon-folder-opened" aria-hidden="true" />
                            <span>{t('Open Folder')}</span>
                        </button>
                        <button
                            className={styles.stateButton}
                            type="button"
                            onClick={handleInitializeRepository}
                        >
                            <i className="codicon codicon-repo-create" aria-hidden="true" />
                            <span>{t('Initialize Repository')}</span>
                        </button>
                        <button
                            className={styles.stateButton}
                            type="button"
                            onClick={() => void rpc.configureAIProvider()}
                        >
                            <i className="codicon codicon-sparkle" aria-hidden="true" />
                            <span>{t('Configure AI Provider')}</span>
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    const logListPanel = activeRepositoryLoading && !repositoryPath ? (
        <div className={styles.loadingPlaceholder}>
            <LoadingProgressBar active={activeRepositoryLoading} ariaLabel={t('Loading...')} />
        </div>
    ) : (
        <LogListPanel
            onSelectionChange={setSelectedHashes}
            externalBranchFilter={branchFilter}
            isNarrowMode={isNarrowMode}
            commitDetails={commitDetails}
            repositoryPath={repositoryPath}
        />
    );

    const commitDetailsPanel = (
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
                first={(
                    <BranchListPanel
                        data={branchListData}
                        isLoading={branchListLoading}
                        onBranchFilter={handleBranchFilter}
                    />
                )}
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
