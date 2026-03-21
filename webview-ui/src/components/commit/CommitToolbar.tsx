import { rpc, rpcEvents } from '../../lib/rpc_client';
import { useTranslation } from 'react-i18next';
import { ViewModeToggle } from '../common/ViewModeToggle';
import styles from './CommitToolbar.module.css';

interface CommitToolbarProps {
    viewMode: 'tree' | 'list';
    selectedFiles: Set<string>;
    selectedStageablePaths: string[];
    selectedUnstageablePaths: string[];
    onViewModeChange: (mode: 'tree' | 'list') => void;
    onExpandAll: () => void;
    onCollapseAll: () => void;
}

export function CommitToolbar({
    viewMode,
    selectedFiles,
    selectedStageablePaths,
    selectedUnstageablePaths,
    onViewModeChange,
    onExpandAll,
    onCollapseAll
}: CommitToolbarProps) {
    const { t } = useTranslation();

    return (
        <div className={styles.commitToolbar}>
            <div className={styles.toolbarLeft}>
                <button className={styles.iconBtn} title={t('Refresh')} onClick={() => rpcEvents.refresh.emit()}>
                    <i className="codicon codicon-sync"></i>
                </button>

                <div className={styles.toolbarSeparator} style={{ margin: '0 8px' }}></div>

                <button className={styles.iconBtn} title={t('Rollback')} onClick={() => rpc.rollback(Array.from(selectedFiles))} disabled={selectedFiles.size === 0}>
                    <i className="codicon codicon-discard"></i>
                </button>
                <button className={styles.iconBtn} title={t('Stash')} onClick={() => rpc.stash({ files: Array.from(selectedFiles) })} disabled={selectedFiles.size === 0}>
                    <i className="codicon codicon-archive"></i>
                </button>
                <button
                    className={styles.iconBtn}
                    title={t('Stage Selected')}
                    onClick={async () => {
                        await rpc.stageFiles(selectedStageablePaths);
                        rpcEvents.refresh.emit();
                    }}
                    disabled={selectedStageablePaths.length === 0}
                >
                    <i className="codicon codicon-add"></i>
                </button>
                <button
                    className={styles.iconBtn}
                    title={t('Unstage Selected')}
                    onClick={async () => {
                        await Promise.all(selectedUnstageablePaths.map(path => rpc.unstage(path)));
                        rpcEvents.refresh.emit();
                    }}
                    disabled={selectedUnstageablePaths.length === 0}
                >
                    <i className="codicon codicon-remove"></i>
                </button>
                <div className={styles.toolbarSeparator}></div>
                <button
                    className={styles.iconBtn}
                    title={t('Expand All')}
                    onClick={onExpandAll}
                >
                    <i className="codicon codicon-expand-all"></i>
                </button>
                <button
                    className={styles.iconBtn}
                    title={t('Collapse All')}
                    onClick={onCollapseAll}
                >
                    <i className="codicon codicon-collapse-all"></i>
                </button>
                <div className={styles.toolbarSeparator}></div>
                <ViewModeToggle viewMode={viewMode} onChange={onViewModeChange} />
            </div>
        </div>
    );
}
