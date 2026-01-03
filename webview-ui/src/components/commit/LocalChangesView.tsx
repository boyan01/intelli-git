import { CommitView } from './CommitView';
import { StashView } from '../stash/StashView';
import { useTranslation } from 'react-i18next';
import { usePersistedState } from '../../hooks/usePersistedState';
import { useRpcData } from '../../hooks/useRpcData';
import { rpc } from '../../lib/rpc_client';
import type { BranchInfo } from '@shared/messages';
import styles from './LocalChangesView.module.css';

const defaultBranchInfo: BranchInfo = {
    current: '',
    all: [],
    ahead: 0,
    behind: 0,
    rebaseStatus: 'none'
};

function RebaseIndicator({ status }: { status: 'interactive' | 'merging' }) {
    return (
        <>
            <span className="codicon codicon-git-merge" style={{ color: 'var(--vscode-inputValidation-warningForeground)', marginRight: '4px' }}></span>
            <span style={{ fontWeight: 'bold', fontSize: '11px', marginRight: '4px' }}>
                {status === 'interactive' ? 'Rebasing' : 'Merging'}
            </span>
            <div
                className={styles.continueBtn}
                onClick={(e) => {
                    e.stopPropagation();
                    rpc.continueRebase({});
                }}
                title="Continue Rebase/Merge"
            >
                <span className="codicon codicon-play"></span>
            </div>
            <div
                className={styles.abortBtn}
                onClick={(e) => {
                    e.stopPropagation();
                    rpc.abortRebase();
                }}
                title="Abort Rebase/Merge"
            >
                <span className="codicon codicon-close"></span>
            </div>
        </>
    );
}

function BranchStatus({ current, ahead, behind }: { current: string; ahead?: number; behind?: number }) {
    return (
        <>
            <i className="codicon codicon-repo-forked" style={{ marginRight: '4px' }}></i>
            <span style={{ fontSize: '11px', marginRight: '4px', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{current}</span>

            {(ahead || 0) > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', color: 'var(--vscode-gitDecoration-addedResourceForeground)', marginLeft: '2px' }}>
                    <i className="codicon codicon-arrow-up" style={{ fontSize: '10px', transform: 'rotate(45deg)' }}></i>
                    <span style={{ fontSize: '10px' }}>{ahead}</span>
                </div>
            )}

            {(behind || 0) > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', color: 'var(--vscode-gitDecoration-deletedResourceForeground)', marginLeft: '2px' }}>
                    <i className="codicon codicon-arrow-down" style={{ fontSize: '10px', transform: 'rotate(45deg)' }}></i>
                    <span style={{ fontSize: '10px' }}>{behind}</span>
                </div>
            )}
        </>
    );
}

export function LocalChangesView() {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = usePersistedState('commit.activeTab');
    const { data: branches } = useRpcData(() => rpc.getBranchInfo(), { initialValue: defaultBranchInfo });

    const isRebasing = branches.rebaseStatus && branches.rebaseStatus !== 'none';

    return (
        <div className={styles.container}>
            <div className={styles.headerTabs}>
                <div className={styles.tabsLeft}>
                    <button
                        className={`${styles.tab} ${activeTab === 'commit' ? styles.active : ''}`}
                        onClick={() => setActiveTab('commit')}
                    >
                        {t('commitView.tabs.commit')}
                    </button>
                    <button
                        className={`${styles.tab} ${activeTab === 'stash' ? styles.active : ''}`}
                        onClick={() => setActiveTab('stash')}
                    >
                        {t('commitView.tabs.stash')}
                    </button>
                </div>
                <div className={styles.tabsRight}>
                    <button className={styles.iconBtn} title={t('commitView.toolbar.fetch')} onClick={() => rpc.fetch()}>
                        <i className="codicon codicon-cloud-download"></i>
                    </button>

                    {branches?.current && (
                        <div
                            className={`${styles.branchIndicator} ${isRebasing ? styles.rebaseActive : ''}`}
                            onClick={() => rpc.pickBranch()}
                            title={isRebasing
                                ? `Rebase in progress (${branches.rebaseStatus})`
                                : t('toolbar.branchTooltip')}
                        >
                            {isRebasing ? (
                                <RebaseIndicator status={branches.rebaseStatus as 'interactive' | 'merging'} />
                            ) : (
                                <BranchStatus current={branches.current} ahead={branches.ahead} behind={branches.behind} />
                            )}
                        </div>
                    )}

                </div>
            </div>

            <div className={styles.content}>
                {activeTab === 'commit' && <CommitView rebaseStatus={branches?.rebaseStatus} />}
                {activeTab === 'stash' && <StashView />}
            </div>
        </div>
    );
}
