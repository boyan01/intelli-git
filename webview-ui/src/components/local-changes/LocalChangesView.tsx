import { useState, useCallback, useRef, useLayoutEffect } from 'react';
import { CommitView } from '../commit/CommitView';
import { StashView } from '../stash/StashView';
import { PushTab } from '../push/PushTab';
import { useTranslation } from 'react-i18next';
import { usePersistedState } from '../../hooks/usePersistedState';
import { useRpcData } from '../../hooks/useRpcData';
import { rpc } from '../../lib/rpc_client';
import type { BranchInfo } from '@shared/messages';
import { BranchStatus } from '../common/BranchStatus';
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



export function LocalChangesView() {
    const { t } = useTranslation();
    const [persistedTab, setPersistedTab] = usePersistedState('commit.activeTab');
    const [tabTimestamp, setTabTimestamp] = usePersistedState('commit.activeTabTimestamp');
    const { data: branches } = useRpcData(() => rpc.getBranchInfo(), {
        initialValue: defaultBranchInfo,
        cacheKey: 'commit.branchInfo'
    });

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

    const tabsRef = {
        commit: useRef<HTMLButtonElement>(null),
        stash: useRef<HTMLButtonElement>(null),
        push: useRef<HTMLButtonElement>(null)
    };
    const activeIndicatorRef = useRef<HTMLDivElement>(null);

    // Update indicator position using ResizeObserver and RAF to handle CSS transitions
    useLayoutEffect(() => {
        const updateIndicator = () => {
            const activeEl = tabsRef[activeTab]?.current;
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
        Object.values(tabsRef).forEach(ref => {
            if (ref.current) {
                observer.observe(ref.current);
            }
        });

        return () => {
            cancelAnimationFrame(rafId);
            observer.disconnect();
        };
    }, [activeTab]);

    const isRebasing = branches.rebaseStatus && branches.rebaseStatus !== 'none';

    return (
        <div className={styles.container}>
            <div className={styles.headerTabs}>
                <div className={styles.tabsLeft}>
                    <div
                        ref={activeIndicatorRef}
                        className={styles.activeIndicator}
                    />
                    <button
                        ref={tabsRef.commit}
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
                        ref={tabsRef.stash}
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
                        ref={tabsRef.push}
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
                    {branches?.current && (
                        isRebasing ? (
                            <div
                                className={`${styles.branchIndicator} ${styles.rebaseActive}`}
                                onClick={() => rpc.pickBranch()}
                                title={`Rebase in progress (${branches.rebaseStatus})`}
                            >
                                <RebaseIndicator status={branches.rebaseStatus as 'interactive' | 'merging'} />
                            </div>
                        ) : (
                            <div style={{ marginRight: '4px' }}>
                                <BranchStatus
                                    current={branches.current}
                                    ahead={branches.ahead}
                                    behind={branches.behind}
                                    onPush={() => setActiveTab('push')}
                                />
                            </div>
                        )
                    )}

                </div>
            </div>

            <div className={styles.content}>
                {activeTab === 'commit' && <CommitView rebaseStatus={branches?.rebaseStatus} />}
                {activeTab === 'stash' && <StashView />}
                {activeTab === 'push' && <PushTab />}
            </div>
        </div >
    );
}
