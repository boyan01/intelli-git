import { useState, useCallback } from 'react';
import { FileTree } from './FileTree';
import { CommitForm } from './CommitForm';
import { StashList } from './StashList';
import { useVSCode } from '../hooks/useVSCode';

export function CommitView() {
    const { changelists, stashList, postMessage } = useVSCode();
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

    const toggleGroupCollapse = (groupId: string) => {
        setCollapsedGroups(prev => {
            const next = new Set(prev);
            if (next.has(groupId)) next.delete(groupId);
            else next.add(groupId);
            return next;
        });
    };

    const handleCommit = (push: boolean) => {
        const files = Array.from(selectedFiles);
        if (files.length === 0 && !amend) { 
            // Allow empty commit if amend? Usually git commit needs changes or --allow-empty. 
            // Standard check: if files empty and not amend, warn.
            // If amend, maybe okay.
            return;
        }
        postMessage({
            command: push ? 'commitAndPush' : 'commit',
            message: commitMessage,
            files: files,
            amend: amend
        });
    };

    const handleStashAction = (action: 'apply' | 'pop' | 'drop', index: string) => {
        postMessage({
            command: action === 'drop' ? 'stashDrop' : (action === 'pop' ? 'stashPop' : 'stashApply'),
            index: index
        });
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
                     {/* File Toolbar */}
                     <div className="file-toolbar">
                        <div className="toolbar-left">
                           <button className="icon-btn" title="刷新" onClick={() => postMessage({ command: 'refresh' })}>
                               <i className="codicon codicon-sync"></i>
                           </button>
                           <button className="icon-btn" title="回滚" onClick={() => {
                                postMessage({ command: 'rollback', files: Array.from(selectedFiles) });
                           }}>
                               <i className="codicon codicon-discard"></i>
                           </button>
                           <button className="icon-btn" title="贮藏" onClick={() => {
                                postMessage({ command: 'stash', files: Array.from(selectedFiles) });
                           }}>
                               <i className="codicon codicon-archive"></i>
                           </button>
                           <div className="toolbar-separator"></div>
                           <button 
                                className={`icon-btn ${viewMode === 'tree' ? 'active' : ''}`} 
                                title="视图选项" 
                                onClick={() => setViewMode(v => v === 'tree' ? 'list' : 'tree')}
                           >
                               <i className="codicon codicon-list-tree"></i>
                           </button>
                        </div>
                     </div>

                     {/* File List */}
                     <div className="file-list">
                         {changelists.map(group => {
                             const isCollapsed = collapsedGroups.has(group.id);
                             const allSelected = group.items.length > 0 && group.items.every(f => selectedFiles.has(f.path));
                             
                             return (
                             <div key={group.id}>
                                 <div 
                                    className={`file-group-header ${isCollapsed ? 'collapsed' : ''}`}
                                    onClick={() => toggleGroupCollapse(group.id)}
                                 >
                                     <input 
                                        type="checkbox" 
                                        className="checkbox"
                                        checked={allSelected}
                                        onClick={(e) => e.stopPropagation()}
                                        onChange={(e) => {
                                            const checked = e.target.checked;
                                            group.items.forEach(f => toggleFile(f.path, checked));
                                        }}
                                     />
                                     <span className="codicon codicon-chevron-down arrow"></span>
                                     <span className="title">{group.name}</span>
                                     <span className="count">{group.items.length} 文件</span>
                                 </div>
                                 {!isCollapsed && (
                                     <FileTree 
                                        files={group.items} 
                                        viewMode={viewMode} 
                                        selectedFiles={selectedFiles}
                                        onToggleFile={toggleFile} 
                                     />
                                 )}
                             </div>
                         )})}
                         {changelists.length === 0 && <div className="empty-state">没有更改</div>}
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
