import type { ChangelistGroup } from '@shared/messages';
import { vscode } from '../lib/vscode';
import { logger } from '../lib/log';

interface CommitToolbarProps {
    viewMode: 'tree' | 'list';
    selectedFiles: Set<string>;
    changelists: ChangelistGroup[];
    collapsedGroups: Set<string>;
    onViewModeChange: (mode: 'tree' | 'list') => void;
    onExpandAll: () => void;
    onCollapseAll: () => void;
}

export function CommitToolbar({
    viewMode,
    selectedFiles,
    changelists,
    collapsedGroups,
    onViewModeChange,
    onExpandAll,
    onCollapseAll
}: CommitToolbarProps) {
    const allGroupIds = changelists.map(g => g.id);
    const allCollapsed = allGroupIds.length > 0 && allGroupIds.every(id => collapsedGroups.has(id));
    const allExpanded = allGroupIds.length > 0 && allGroupIds.every(id => !collapsedGroups.has(id));

    return (
        <div className="file-toolbar">
            <div className="toolbar-left">
                <button className="icon-btn" title="刷新" onClick={() => vscode.postMessage({ type: 'refresh' })}>
                    <i className="codicon codicon-sync"></i>
                </button>
                <button className="icon-btn" title="回滚" onClick={() => vscode.postMessage({ type: 'rollback', files: Array.from(selectedFiles) })} disabled={selectedFiles.size === 0}>
                    <i className="codicon codicon-discard"></i>
                </button>
                <button className="icon-btn" title="贮藏" onClick={() => vscode.postMessage({ type: 'stash', files: Array.from(selectedFiles) })} disabled={selectedFiles.size === 0}>
                    <i className="codicon codicon-archive"></i>
                </button>
                <div className="toolbar-separator"></div>
                <button 
                    className={`icon-btn ${!allCollapsed ? 'active' : ''}`} 
                    title="全部展开" 
                    onClick={onExpandAll}
                    disabled={allExpanded}
                >
                    <i className="codicon codicon-expand-all"></i>
                </button>
                <button 
                    className={`icon-btn ${allCollapsed ? 'active' : ''}`} 
                    title="全部收起" 
                    onClick={onCollapseAll}
                    disabled={allCollapsed}
                >
                    <i className="codicon codicon-collapse-all"></i>
                </button>
                <div className="toolbar-separator"></div>
                <button 
                    className={`icon-btn ${viewMode === 'tree' ? 'active' : ''}`} 
                    title="视图选项" 
                    onClick={() => onViewModeChange(viewMode === 'tree' ? 'list' : 'tree')}
                >
                    <i className="codicon codicon-list-tree"></i>
                </button>
            </div>
        </div>
    );
}
