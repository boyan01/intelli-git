import { rpc, rpcEvents } from '../../lib/rpc_client';
import { useTranslation } from 'react-i18next';
import styles from './CommitToolbar.module.css';

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
        <div className={styles.commitToolbar}>
            <div className={styles.toolbarLeft}>
                <button className={styles.iconBtn} title={t('commitView.toolbar.refresh')} onClick={() => rpcEvents.refresh.emit()}>
                    <i className="codicon codicon-sync"></i>
                </button>

                <div className={styles.toolbarSeparator} style={{ margin: '0 8px' }}></div>

                <button className={styles.iconBtn} title={t('commitView.toolbar.rollback')} onClick={() => rpc.rollback(Array.from(selectedFiles))} disabled={selectedFiles.size === 0}>
                    <i className="codicon codicon-discard"></i>
                </button>
                <button className={styles.iconBtn} title={t('commitView.toolbar.stash')} onClick={() => rpc.stash({ files: Array.from(selectedFiles) })} disabled={selectedFiles.size === 0}>
                    <i className="codicon codicon-archive"></i>
                </button>
                <div className={styles.toolbarSeparator}></div>
                <button
                    className={styles.iconBtn}
                    title={t('commitView.toolbar.expandAll')}
                    onClick={onExpandAll}
                >
                    <i className="codicon codicon-expand-all"></i>
                </button>
                <button
                    className={styles.iconBtn}
                    title={t('commitView.toolbar.collapseAll')}
                    onClick={onCollapseAll}
                >
                    <i className="codicon codicon-collapse-all"></i>
                </button>
                <div className={styles.toolbarSeparator}></div>
                <button
                    className={`${styles.iconBtn} ${viewMode === 'tree' ? styles.active : ''}`}
                    title={t('commitView.toolbar.viewMode')}
                    onClick={() => onViewModeChange(viewMode === 'tree' ? 'list' : 'tree')}
                >
                    <i className="codicon codicon-list-tree"></i>
                </button>
            </div>
        </div>
    );
}
