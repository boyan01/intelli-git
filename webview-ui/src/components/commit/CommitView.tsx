import { useState, useCallback, useEffect, useMemo } from 'react';
import { ChangelistTree } from '../file-tree/ChangelistTree';
import { CommitForm } from './CommitForm';
import { RebaseForm } from './RebaseForm';
import { CommitToolbar } from './CommitToolbar';
import { StashList } from '../stash/StashList';
import { useTranslation } from 'react-i18next';
import { usePersistedState } from '../../hooks/usePersistedState';
import styles from './CommitView.module.css';
import { rpc, rpcEvents } from '../../lib/rpc_client';
import type { ChangelistGroup, BranchInfo } from '@shared/messages';

export function CommitView() {
    const { t } = useTranslation();

    // Data State
    const [changelists, setChangelists] = useState<ChangelistGroup[]>([]);
    const [branches, setBranches] = useState<BranchInfo>({ current: '', all: [], ahead: 0, behind: 0, rebaseStatus: 'none' });
    const [incomingCommits, setIncomingCommits] = useState(0);
    const [activeFile, setActiveFile] = useState<string | null>(null);

    // Persisted UI State
    const [activeTab, setActiveTab] = usePersistedState('commit.activeTab');
    const [viewMode, setViewMode] = usePersistedState('commit.viewMode');
    const [selectedFiles, setSelectedFiles] = usePersistedState('commit.selectedFiles');
    const [collapsedGroups, setCollapsedGroups] = usePersistedState('commit.collapsedGroups');
    const [commitMessage, setCommitMessage] = usePersistedState('commit.message');
    const [amend, setAmend] = usePersistedState('commit.amend');

    // Non-persisted state
    const [isGenerating, setIsGenerating] = useState(false);

    // Data loading functions
    const loadChangelists = useCallback(async () => {
        try {
            const data = await rpc.getChangelists();
            setChangelists(data);
        } catch (e) {
            console.error('Failed to load changelists:', e);
        }
    }, []);

    const loadBranchInfo = useCallback(async () => {
        try {
            const data = await rpc.getBranchInfo();
            setBranches(data);
        } catch (e) {
            console.error('Failed to load branch info:', e);
        }
    }, []);

    const loadIncomingCommits = useCallback(async () => {
        try {
            const count = await rpc.getIncomingCommits();
            setIncomingCommits(count);
        } catch (e) {
            console.error('Failed to load incoming commits:', e);
        }
    }, []);

    // Initial Load & Event Subscriptions
    useEffect(() => {
        loadChangelists();
        loadBranchInfo();
        loadIncomingCommits();

        const unsubRefresh = rpcEvents.refresh.subscribe(() => {
            loadChangelists();
            loadBranchInfo();
            loadIncomingCommits();
        });

        const unsubActiveFile = rpcEvents.activeFileChange.subscribe(({ path }) => {
            setActiveFile(path);
        });

        return () => {
            unsubRefresh();
            unsubActiveFile();
        };
    }, [loadChangelists, loadBranchInfo, loadIncomingCommits]);

    const toggleFile = useCallback((path: string, checked: boolean) => {
        setSelectedFiles(prev => {
            const next = new Set(prev);
            if (checked) next.add(path);
            else next.delete(path);
            return next;
        });
    }, [setSelectedFiles]);

    const toggleGroupCollapse = useCallback((groupId: string) => {
        setCollapsedGroups(prev => {
            const next = new Set(prev);
            if (next.has(groupId)) next.delete(groupId);
            else next.add(groupId);
            return next;
        });
    }, [setCollapsedGroups]);

    const fileStats = useMemo(() => {
        let added = 0;
        let modified = 0;
        let deleted = 0;

        changelists.forEach(group => {
            group.items.forEach(file => {
                if (selectedFiles.has(file.path)) {
                    const status = file.status.trim().toUpperCase();
                    if (status.startsWith('A') || status === '?' || status === 'U') {
                        added++;
                    } else if (status.startsWith('D')) {
                        deleted++;
                    } else {
                        modified++;
                    }
                }
            });
        });

        return { added, modified, deleted };
    }, [changelists, selectedFiles]);

    const handleCommit = async (push: boolean) => {
        const files = Array.from(selectedFiles);
        if (files.length === 0 && !amend) {
            return;
        }
        try {
            await rpc.commit({
                message: commitMessage,
                files: files,
                amend: amend,
                push: push
            });
            setCommitMessage('');
        } catch (e) {
            console.error('Commit failed:', e);
        }
    };

    const handleGenerateMessage = async () => {
        setIsGenerating(true);
        try {
            const message = await rpc.generateCommitMessage(Array.from(selectedFiles));
            setCommitMessage(message);
        } catch (e) {
            console.error('Failed to generate message', e);
        } finally {
            setIsGenerating(false);
        }
    };

    const handleFetch = () => rpc.fetch();
    const handleBranchClick = () => rpc.pickBranch();

    return (
        <div className={styles.commitPanel}>
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
                    <button className={styles.iconBtn} title={t('commitView.toolbar.fetch')} onClick={handleFetch}>
                        <i className="codicon codicon-cloud-download"></i>
                    </button>

                    {incomingCommits > 0 && (
                        <div
                            className={styles.incomingCommits}
                            onClick={handleFetch}
                            title={t('toolbar.incomingTooltip', { count: incomingCommits })}
                        >
                            <span className="codicon codicon-cloud-download"></span>
                            <span>{incomingCommits}</span>
                            <span className="incoming-arrow">⬇️</span>
                        </div>
                    )}

                    {branches?.current && (
                        <div
                            className={`${styles.branchIndicator} ${branches.rebaseStatus && branches.rebaseStatus !== 'none' ? styles.rebaseActive : ''}`}
                            onClick={handleBranchClick}
                            title={branches.rebaseStatus && branches.rebaseStatus !== 'none'
                                ? `Rebase in progress (${branches.rebaseStatus})`
                                : t('toolbar.branchTooltip')}
                        >
                            {branches.rebaseStatus && branches.rebaseStatus !== 'none' ? (
                                <>
                                    <span className="codicon codicon-git-merge" style={{ color: 'var(--vscode-inputValidation-warningForeground)', marginRight: '4px' }}></span>
                                    <span style={{ fontWeight: 'bold', fontSize: '11px', marginRight: '4px' }}>
                                        {branches.rebaseStatus === 'interactive' ? 'Rebasing' : 'Merging'}
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
                            ) : (
                                <>
                                    <i className="codicon codicon-repo-forked" style={{ marginRight: '4px' }}></i>
                                    <span style={{ fontSize: '11px', marginRight: '4px', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{branches.current}</span>

                                    {(branches.ahead || 0) > 0 && (
                                        <div style={{ display: 'flex', alignItems: 'center', color: 'var(--vscode-gitDecoration-addedResourceForeground)', marginLeft: '2px' }}>
                                            <i className="codicon codicon-arrow-up" style={{ fontSize: '10px', transform: 'rotate(45deg)' }}></i>
                                            <span style={{ fontSize: '10px' }}>{branches.ahead}</span>
                                        </div>
                                    )}

                                    {(branches.behind || 0) > 0 && (
                                        <div style={{ display: 'flex', alignItems: 'center', color: 'var(--vscode-gitDecoration-deletedResourceForeground)', marginLeft: '2px' }}>
                                            <i className="codicon codicon-arrow-down" style={{ fontSize: '10px', transform: 'rotate(45deg)' }}></i>
                                            <span style={{ fontSize: '10px' }}>{branches.behind}</span>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}

                    <button className={styles.iconBtn} title="More Actions">
                        <i className="codicon codicon-ellipsis"></i>
                    </button>
                </div>
            </div>

            {activeTab === 'commit' && (
                <div className={`${styles.tabContent} ${activeTab === 'commit' ? styles.active : ''}`}>
                    <CommitToolbar
                        viewMode={viewMode}
                        selectedFiles={selectedFiles}
                        onViewModeChange={setViewMode}
                        onExpandAll={() => setCollapsedGroups(new Set())}
                        onCollapseAll={() => setCollapsedGroups(new Set(changelists.map(g => g.id)))}
                    />

                    <div className={styles.fileListContainer}>
                        {changelists.length === 0 ? (
                            <div className={styles.emptyState}>{t('commitView.emptyState')}</div>
                        ) : (
                            changelists.map(group => (
                                <ChangelistTree
                                    key={group.id}
                                    group={group}
                                    viewMode={viewMode}
                                    selectedFiles={selectedFiles}
                                    isCollapsed={collapsedGroups.has(group.id)}
                                    activeFile={activeFile}
                                    onToggleFile={toggleFile}
                                    onToggleCollapse={() => toggleGroupCollapse(group.id)}
                                    onRollback={(files) => rpc.rollback(files)}
                                    onStash={(files) => rpc.stash({ files })}
                                    onDelete={(files) => rpc.deleteFiles(files)}
                                    onMoveToChangelist={(files) => rpc.promptCreateChangelist(files[0])}
                                />
                            ))
                        )}
                    </div>

                    {branches?.rebaseStatus === 'interactive' ? (
                        <RebaseForm
                            message={commitMessage}
                            addedCount={fileStats.added}
                            modifiedCount={fileStats.modified}
                            deletedCount={fileStats.deleted}
                            disableContinue={changelists.some(g => g.items.some(f => f.status === 'C' || f.status === 'U'))}
                            onMessageChange={setCommitMessage}
                            onContinue={() => rpc.continueRebase({
                                message: commitMessage,
                                files: Array.from(selectedFiles)
                            })}
                        />
                    ) : (
                        <CommitForm
                            message={commitMessage}
                            amend={amend}
                            addedCount={fileStats.added}
                            modifiedCount={fileStats.modified}
                            deletedCount={fileStats.deleted}
                            onMessageChange={setCommitMessage}
                            onAmendChange={setAmend}
                            onCommit={handleCommit}
                            isGenerating={isGenerating}
                            onGenerate={handleGenerateMessage}
                        />
                    )}
                </div>
            )}

            {activeTab === 'stash' && (
                <div className={`${styles.tabContent} ${activeTab === 'stash' ? styles.active : ''}`}>
                    <StashList />
                </div>
            )}
        </div>
    );
}
