import { useState, useCallback, useRef, useLayoutEffect, useEffect } from 'react';
import { CommitView } from '../commit/CommitView';
import { StashView } from '../stash/StashView';
import { PushTab } from '../push/PushTab';
import type { CommitOptions } from '../commit/CommitForm';
import { useTranslation } from 'react-i18next';
import { usePersistedState } from '../../hooks/usePersistedState';
import { useRpcData } from '../../hooks/useRpcData';
import { rpc, rpcEvents } from '../../lib/rpc_client';
import { useVersionCheck } from '../../hooks/useVersionCheck';
import type { BranchInfo, WorktreeInfo } from '@shared/messages';
import { BranchStatus } from '../common/BranchStatus';
import { VersionCheckBanner } from '../common/VersionCheckBanner';
import { VersionExpiredPanel } from '../common/VersionExpiredPanel';
import { WorktreeDrawer } from './WorktreeDrawer';
import { usePushBranches } from '../push/hooks/usePushBranches';
import styles from './LocalChangesView.module.css';

const defaultBranchInfo: BranchInfo = {
    current: '',
    all: [],
    ahead: 0,
    behind: 0,
    rebaseStatus: 'none'
};

function RebaseIndicator({ status }: { status: 'interactive' | 'merging' }) {
    const { t } = useTranslation();

    return (
        <>
            <span className="codicon codicon-git-merge" style={{ color: 'var(--vscode-inputValidation-warningForeground)', marginRight: '4px' }}></span>
            <span style={{ fontWeight: 'bold', fontSize: '11px', marginRight: '4px' }}>
                {status === 'interactive' ? t('Rebasing') : t('Merging')}
            </span>
            <div
                className={styles.continueBtn}
                onClick={(e) => {
                    e.stopPropagation();
                    rpc.continueRebase({});
                }}
                title={status === 'interactive' ? t('Continue Rebase') : t('Continue Merge')}
            >
                <span className="codicon codicon-play"></span>
            </div>
            <div
                className={styles.abortBtn}
                onClick={(e) => {
                    e.stopPropagation();
                    rpc.abortRebase();
                }}
                title={status === 'interactive' ? t('Abort Rebase') : t('Abort Merge')}
            >
                <span className="codicon codicon-close"></span>
            </div>
        </>
    );
}



export function LocalChangesView() {
    const { t } = useTranslation();
    const [persistedTab, setPersistedTab] = usePersistedState('commit.activeTab');
    const [tabTimestamp, setTabTimestamp] = usePersistedState('commit.activeTabTimestamp');
    const loadBranchInfo = useCallback(() => rpc.getBranchInfo(), []);
    const loadWorktrees = useCallback(() => rpc.getWorktrees(), []);
    const { data: branches } = useRpcData(loadBranchInfo, {
        initialValue: defaultBranchInfo,
        cacheKey: 'commit.branchInfo'
    });
    const { data: worktrees, loading: worktreesLoading } = useRpcData(loadWorktrees, {
        initialValue: [] as WorktreeInfo[]
    });
    const [worktreeDrawerOpen, setWorktreeDrawerOpen] = useState(false);
    const [reviewingCommitPushTarget, setReviewingCommitPushTarget] = useState(false);
    const [commitOptions, setCommitOptions] = useState<CommitOptions>({
        push: false,
        signOff: false
    });
    const pushBranches = usePushBranches();

    // Determine initial tab: use persisted value only if set within 10 seconds
    const [activeTab, setActiveTabState] = useState<'commit' | 'stash' | 'push'>(() => {
        const elapsed = Date.now() - tabTimestamp;
        return elapsed > 10000 ? 'commit' : persistedTab;
    });

    const setActiveTab = useCallback((tab: 'commit' | 'stash' | 'push') => {
        setActiveTabState(tab);
        setPersistedTab(tab);
        setTabTimestamp(Date.now());
    }, [setPersistedTab, setTabTimestamp]);

    const commitTabRef = useRef<HTMLButtonElement>(null);
    const stashTabRef = useRef<HTMLButtonElement>(null);
    const pushTabRef = useRef<HTMLButtonElement>(null);
    const activeIndicatorRef = useRef<HTMLDivElement>(null);

    // Update indicator position using ResizeObserver and RAF to handle CSS transitions
    useLayoutEffect(() => {
        const updateIndicator = () => {
            const tabsRefs = {
                commit: commitTabRef,
                stash: stashTabRef,
                push: pushTabRef
            };
            const activeEl = tabsRefs[activeTab]?.current;
            const indicator = activeIndicatorRef.current;
            if (activeEl && indicator) {
                indicator.style.left = `${activeEl.offsetLeft}px`;
                indicator.style.width = `${activeEl.offsetWidth}px`;
            }
        };

        // Initial update
        updateIndicator();

        // Use Loop for smooth animation tracking during transition (300ms)
        const startTime = Date.now();
        let rafId: number;
        const animate = () => {
            updateIndicator();
            if (Date.now() - startTime < 400) { // Run slightly longer than transition
                rafId = requestAnimationFrame(animate);
            }
        };
        rafId = requestAnimationFrame(animate);

        const observer = new ResizeObserver(() => {
            updateIndicator();
        });

        // Observe all tabs
        [commitTabRef, stashTabRef, pushTabRef].forEach(ref => {
            if (ref.current) {
                observer.observe(ref.current);
            }
        });

        return () => {
            cancelAnimationFrame(rafId);
            observer.disconnect();
        };
    }, [activeTab]);

    useEffect(() => {
        return rpcEvents.switchTab.subscribe((tab) => {
            setActiveTab(tab);
        });
    }, [setActiveTab]);

    useEffect(() => {
        return rpcEvents.toggleWorktreesDrawer.subscribe(() => {
            setWorktreeDrawerOpen(open => !open);
        });
    }, []);

    useEffect(() => {
        if (activeTab !== 'push' && reviewingCommitPushTarget) {
            setReviewingCommitPushTarget(false);
        }
    }, [activeTab, reviewingCommitPushTarget]);

    const reviewCommitPushTarget = useCallback(() => {
        setReviewingCommitPushTarget(true);
        setActiveTab('push');
    }, [setActiveTab]);

    const returnToCommitAfterTargetConfirmation = useCallback(() => {
        pushBranches.confirmSelectedTarget();
        setReviewingCommitPushTarget(false);
        setActiveTab('commit');
    }, [pushBranches, setActiveTab]);

    const returnToCommitAfterTargetChange = useCallback(() => {
        setReviewingCommitPushTarget(false);
        setActiveTab('commit');
    }, [setActiveTab]);

    const isRebasing = branches.rebaseStatus && branches.rebaseStatus !== 'none';
    const { isExpired } = useVersionCheck();

    if (isExpired) {
        return (
            <div className={styles.container}>
                <VersionExpiredPanel />
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <VersionCheckBanner />
            <WorktreeDrawer
                open={worktreeDrawerOpen}
                worktrees={worktrees}
                loading={worktreesLoading}
                onClose={() => setWorktreeDrawerOpen(false)}
            />
            <div className={styles.headerTabs}>
                <div className={styles.tabsLeft}>
                    <div
                        ref={activeIndicatorRef}
                        className={styles.activeIndicator}
                    />
                    <button
                        ref={commitTabRef}
                        className={`${styles.tab} ${activeTab === 'commit' ? styles.active : ''}`}
                        onClick={() => setActiveTab('commit')}
                        title={t('Commit')}
                    >
                        <i className="codicon codicon-git-commit"></i>
                        <span className={styles.titleWrapper}>
                            <span className={styles.tabTitle}>{t('Commit')}</span>
                        </span>
                    </button>
                    <button
                        ref={stashTabRef}
                        className={`${styles.tab} ${activeTab === 'stash' ? styles.active : ''}`}
                        onClick={() => setActiveTab('stash')}
                        title={t('Stash')}
                    >
                        <i className="codicon codicon-archive"></i>
                        <span className={styles.titleWrapper}>
                            <span className={styles.tabTitle}>{t('Stash')}</span>
                        </span>
                    </button>
                    <button
                        ref={pushTabRef}
                        className={`${styles.tab} ${activeTab === 'push' ? styles.active : ''}`}
                        onClick={() => setActiveTab('push')}
                        title={t('Push')}
                    >
                        <i className="codicon codicon-cloud-upload"></i>
                        <span className={styles.titleWrapper}>
                            <span className={styles.tabTitle}>{t('Push')}</span>
                        </span>
                    </button>
                </div>
                <div className={styles.tabsRight}>
                    {isRebasing ? (
                        <div
                            className={`${styles.branchIndicator} ${styles.rebaseActive}`}
                            onClick={() => rpc.pickBranch()}
                            title={`Rebase in progress (${branches.rebaseStatus})`}
                        >
                            <RebaseIndicator status={branches.rebaseStatus as 'interactive' | 'merging'} />
                        </div>
                    ) : (
                        branches?.current && (
                            <div style={{ marginRight: '4px' }}>
                                <BranchStatus
                                    current={branches.current}
                                    ahead={branches.ahead}
                                    behind={branches.behind}
                                    repositoryName={branches.repositoryName}
                                    repositoryKind={branches.repositoryKind}
                                    repositoryDetached={branches.repositoryDetached}
                                    repositoryPath={branches.repositoryPath}
                                    onPush={() => setActiveTab('push')}
                                />
                            </div>
                        )
                    )}

                </div>
            </div>

            <div className={styles.content}>
                {activeTab === 'commit' && (
                    <CommitView
                        rebaseStatus={branches?.rebaseStatus}
                        pushTarget={pushBranches.pushTarget}
                        isPushTargetLoading={pushBranches.isInitStateLoading}
                        commitOptions={commitOptions}
                        onReviewPushTarget={reviewCommitPushTarget}
                        onCommitOptionsChange={setCommitOptions}
                    />
                )}
                {activeTab === 'stash' && <StashView />}
                {activeTab === 'push' && (
                    <PushTab
                        pushBranches={pushBranches}
                        reviewingCommitTarget={reviewingCommitPushTarget}
                        onUseTargetForCommit={returnToCommitAfterTargetConfirmation}
                        onCommitTargetChanged={returnToCommitAfterTargetChange}
                    />
                )}
            </div>
        </div >
    );
}
