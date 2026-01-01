import { useState, useCallback, useEffect, useMemo } from 'react';
import type { CommitViewState } from '@shared/messages';
import { ChangelistTree } from './ChangelistTree';
import { CommitForm } from './CommitForm';
import { RebaseForm } from './RebaseForm';
import { CommitToolbar } from './CommitToolbar';
import { StashList } from './StashList';
import { useVSCode } from '../hooks/useVSCode';
import { vscode } from '../lib/vscode';
import { useTranslation } from 'react-i18next';

export function CommitView() {
    const { t } = useTranslation();
    const { changelists, stashList, activeFile, branches, incomingCommits } = useVSCode();
    const [activeTab, setActiveTab] = useState<'commit' | 'stash'>('commit');

    // UI State
    const [viewMode, setViewMode] = useState<'tree' | 'list'>('tree');
    const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

    // Commit State
    const [commitMessage, setCommitMessage] = useState('');
    const [amend, setAmend] = useState(false);

    // Initialize state from VSCode storage
    useEffect(() => {
        const savedState = vscode.getState<CommitViewState>();
        if (savedState) {
            if (savedState.viewMode) setViewMode(savedState.viewMode);
            if (savedState.activeTab) setActiveTab(savedState.activeTab);
            if (savedState.commitMessage) setCommitMessage(savedState.commitMessage);
            if (savedState.amend) setAmend(savedState.amend);
            if (savedState.selectedFiles) setSelectedFiles(new Set(savedState.selectedFiles));
            if (savedState.collapsedGroups) setCollapsedGroups(new Set(savedState.collapsedGroups));
        }
    }, []);

    // Persist state changes
    useEffect(() => {
        vscode.setState<CommitViewState>({
            viewMode,
            activeTab,
            commitMessage,
            amend,
            selectedFiles: Array.from(selectedFiles),
            collapsedGroups: Array.from(collapsedGroups)
        });
    }, [viewMode, activeTab, commitMessage, amend, selectedFiles, collapsedGroups]);

    const toggleFile = useCallback((path: string, checked: boolean) => {
        setSelectedFiles(prev => {
            const next = new Set(prev);
            if (checked) next.add(path);
            else next.delete(path);
            return next;
        });
    }, []);

    const toggleGroupCollapse = useCallback((groupId: string) => {
        setCollapsedGroups(prev => {
            const next = new Set(prev);
            if (next.has(groupId)) next.delete(groupId);
            else next.add(groupId);
            return next;
        });
    }, []);

    const fileStats = useMemo(() => {
        let added = 0;
        let modified = 0;
        let deleted = 0;

        changelists.forEach(group => {
            group.items.forEach(file => {
                if (selectedFiles.has(file.path)) {
                    // Check first char of status, usually sufficient for short status
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

    const handleCommit = (push: boolean) => {
        const files = Array.from(selectedFiles);
        if (files.length === 0 && !amend) {
            return;
        }
        vscode.postMessage({
            type: push ? 'commitAndPush' : 'commit',
            message: commitMessage,
            files: files,
            amend: amend
        });
    };

    // Listen for messages from extension to set commit message (e.g. during rebase)
    useEffect(() => {
        const handler = (event: MessageEvent) => {
            const message = event.data;
            switch (message.type) {
                case 'setCommitMessage':
                    setCommitMessage(message.message);
                    break;
            }
        };
        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, []);

    const handleFetch = () => {
        vscode.postMessage({ type: 'fetch' });
    };

    const handleBranchClick = () => {
        vscode.postMessage({ type: 'pickBranch' });
    };

    const handleStashAction = (action: 'apply' | 'pop' | 'drop', index: number) => {
        const typeMap = { apply: 'stashApply', pop: 'stashPop', drop: 'stashDrop' } as const;
        vscode.postMessage({ type: typeMap[action], index });
    };

    return (
        <div className="commit-panel">
            <div className="header-tabs">
                <div className="tabs-left">
                    <button
                        className={`tab ${activeTab === 'commit' ? 'active' : ''}`}
                        onClick={() => setActiveTab('commit')}
                    >
                        {t('commitView.tabs.commit')}
                    </button>
                    <button
                        className={`tab ${activeTab === 'stash' ? 'active' : ''}`}
                        onClick={() => setActiveTab('stash')}
                    >
                        {t('commitView.tabs.stash')}
                    </button>
                </div>
                <div className="tabs-right">
                    <button className="icon-btn" title={t('commitView.toolbar.fetch')} onClick={handleFetch}>
                        <i className="codicon codicon-cloud-download"></i>
                    </button>

                    {incomingCommits > 0 && (
                        <div
                            className="incoming-commits hover-effect"
                            onClick={handleFetch}
                            title={t('toolbar.incomingTooltip', { count: incomingCommits })}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                cursor: 'pointer',
                                padding: '2px 6px',
                                fontSize: '11px'
                            }}
                        >
                            <span className="codicon codicon-cloud-download"></span>
                            <span>{incomingCommits}</span>
                            <span className="incoming-arrow">⬇️</span>
                        </div>
                    )}

                    {branches?.current && (
                        <div
                            className={`branch-indicator ${branches.rebaseStatus && branches.rebaseStatus !== 'none' ? 'rebase-active' : ''}`}
                            onClick={handleBranchClick}
                            title={branches.rebaseStatus && branches.rebaseStatus !== 'none'
                                ? `Rebase in progress (${branches.rebaseStatus})`
                                : t('toolbar.branchTooltip')}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                cursor: 'pointer',
                                marginLeft: '4px',
                                padding: '2px 6px',
                                borderRadius: '3px',
                                marginRight: '4px',
                                height: '20px',
                                backgroundColor: branches.rebaseStatus && branches.rebaseStatus !== 'none' ? 'var(--vscode-inputValidation-warningBackground)' : undefined,
                                border: branches.rebaseStatus && branches.rebaseStatus !== 'none' ? '1px solid var(--vscode-inputValidation-warningBorder)' : undefined
                            }}
                        >
                            {branches.rebaseStatus && branches.rebaseStatus !== 'none' ? (
                                <>
                                    <span className="codicon codicon-git-merge" style={{ color: 'var(--vscode-inputValidation-warningForeground)', marginRight: '4px' }}></span>
                                    <span style={{ fontWeight: 'bold', fontSize: '11px', marginRight: '4px' }}>
                                        {branches.rebaseStatus === 'interactive' ? 'Rebasing' : 'Merging'}
                                    </span>
                                    <div
                                        className="continue-btn hover-effect"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            vscode.postMessage({ type: 'continueRebase' });
                                        }}
                                        title="Continue Rebase/Merge"
                                        style={{
                                            marginLeft: '4px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            color: 'var(--vscode-debugIcon-startForeground)'
                                        }}
                                    >
                                        <span className="codicon codicon-play"></span>
                                    </div>
                                    <div
                                        className="abort-btn hover-effect"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            vscode.postMessage({ type: 'abortRebase' });
                                        }}
                                        title="Abort Rebase/Merge"
                                        style={{
                                            marginLeft: '4px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            color: 'var(--vscode-errorForeground)'
                                        }}
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

                    <button className="icon-btn" title="More Actions">
                        <i className="codicon codicon-ellipsis"></i>
                    </button>
                </div>
            </div>

            {activeTab === 'commit' && (
                <div className="tab-content active">
                    <CommitToolbar
                        viewMode={viewMode}
                        selectedFiles={selectedFiles}
                        onViewModeChange={setViewMode}
                        onExpandAll={() => setCollapsedGroups(new Set())}
                        onCollapseAll={() => setCollapsedGroups(new Set(changelists.map(g => g.id)))}
                    />

                    <div className="file-list-container">
                        {changelists.length === 0 ? (
                            <div className="empty-state">{t('commitView.emptyState')}</div>
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
                                    onRollback={(files) => vscode.postMessage({ type: 'rollback', files })}
                                    onStash={(files) => vscode.postMessage({ type: 'stash', files })}
                                    onDelete={(files) => vscode.postMessage({ type: 'deleteFiles', files })}
                                    onMoveToChangelist={(files) => vscode.postMessage({ type: 'promptCreateChangelist', file: files[0] })}
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
                            onContinue={() => vscode.postMessage({
                                type: 'continueRebase',
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
                        />
                    )}
                </div>
            )}

            {activeTab === 'stash' && (
                <div className="tab-content active">
                    <StashList stashes={stashList} onAction={handleStashAction} />
                </div>
            )}
        </div>
    );
}
