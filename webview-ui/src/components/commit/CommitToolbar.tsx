import { vscode } from '../../lib/vscode';
import { useTranslation } from 'react-i18next';


interface CommitToolbarProps {
    viewMode: 'tree' | 'list';
    selectedFiles: Set<string>;
    onViewModeChange: (mode: 'tree' | 'list') => void;
    onExpandAll: () => void;
    onCollapseAll: () => void;
}

export function CommitToolbar({
    viewMode,
    selectedFiles,
    onViewModeChange,
    onExpandAll,
    onCollapseAll
}: CommitToolbarProps) {
    const { t } = useTranslation();

    return (
        <div className="file-toolbar">
            <div className="toolbar-left">
                <button className="icon-btn" title={t('commitView.toolbar.refresh')} onClick={() => vscode.postMessage({ type: 'refresh' })}>
                    <i className="codicon codicon-sync"></i>
                </button>

                <div className="toolbar-separator" style={{ margin: '0 8px' }}></div>

                <button className="icon-btn" title={t('commitView.toolbar.rollback')} onClick={() => vscode.postMessage({ type: 'rollback', files: Array.from(selectedFiles) })} disabled={selectedFiles.size === 0}>
                    <i className="codicon codicon-discard"></i>
                </button>
                <button className="icon-btn" title={t('commitView.toolbar.stash')} onClick={() => vscode.postMessage({ type: 'stash', files: Array.from(selectedFiles) })} disabled={selectedFiles.size === 0}>
                    <i className="codicon codicon-archive"></i>
                </button>
                <div className="toolbar-separator"></div>
                <button
                    className={`icon-btn`}
                    title={t('commitView.toolbar.expandAll')}
                    onClick={onExpandAll}
                >
                    <i className="codicon codicon-expand-all"></i>
                </button>
                <button
                    className={`icon-btn`}
                    title={t('commitView.toolbar.collapseAll')}
                    onClick={onCollapseAll}
                >
                    <i className="codicon codicon-collapse-all"></i>
                </button>
                <div className="toolbar-separator"></div>
                <button
                    className={`icon-btn ${viewMode === 'tree' ? 'active' : ''}`}
                    title={t('commitView.toolbar.viewMode')}
                    onClick={() => onViewModeChange(viewMode === 'tree' ? 'list' : 'tree')}
                >
                    <i className="codicon codicon-list-tree"></i>
                </button>
            </div>
        </div>
    );
}
