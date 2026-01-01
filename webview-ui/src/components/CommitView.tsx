import { useState, useCallback } from 'react';
import { ChangelistTree } from './ChangelistTree';
import { CommitForm } from './CommitForm';
import { CommitToolbar } from './CommitToolbar';
import { StashList } from './StashList';
import { useVSCode } from '../hooks/useVSCode';
import { vscode } from '../lib/vscode';

export function CommitView() {
    const { changelists, stashList, activeFile } = useVSCode();
    const [activeTab, setActiveTab] = useState<'commit' | 'stash'>('commit');

    // UI State
    const [viewMode, setViewMode] = useState<'tree' | 'list'>('tree');
    const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

    // Commit State
    const [commitMessage, setCommitMessage] = useState('');
    const [amend, setAmend] = useState(false);

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
                        提交
                    </button>
                    <button
                        className={`tab ${activeTab === 'stash' ? 'active' : ''}`}
                        onClick={() => setActiveTab('stash')}
                    >
                        贮藏
                    </button>
                </div>
                <div className="tabs-right">
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
                            <div className="empty-state">没有更改</div>
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

                    <CommitForm
                        message={commitMessage}
                        amend={amend}
                        onMessageChange={setCommitMessage}
                        onAmendChange={setAmend}
                        onCommit={handleCommit}
                    />
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
