import { rpc, rpcEvents } from '../../lib/rpc_client';
import { useTranslation } from 'react-i18next';
import { ViewModeToggle } from '../common/ViewModeToggle';
import type { ChangelistState } from '@shared/messages';
import styles from './CommitToolbar.module.css';

interface CommitToolbarProps {
    viewMode: 'tree' | 'list';
    changelistState: ChangelistState;
    selectedFiles: Set<string>;
    hasTrackedChanges: boolean;
    onViewModeChange: (mode: 'tree' | 'list') => void;
    onExpandAll: () => void;
    onCollapseAll: () => void;
}

export function CommitToolbar({
    viewMode,
    changelistState,
    selectedFiles,
    hasTrackedChanges,
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

                <button
                    className={`${styles.iconBtn} ${changelistState.mode === 'staged' ? styles.activeMode : ''}`}
                    title={t('Staged Mode')}
                    onClick={async () => {
                        await rpc.setChangelistMode('staged');
                        rpcEvents.refresh.emit();
                    }}
                >
                    <i className="codicon codicon-git-stash"></i>
                </button>
                <button
                    className={`${styles.iconBtn} ${changelistState.mode === 'changes' ? styles.activeMode : ''}`}
                    title={t('Changelist Mode')}
                    onClick={async () => {
                        await rpc.setChangelistMode('changes');
                        rpcEvents.refresh.emit();
                    }}
                >
                    <i className="codicon codicon-list-tree"></i>
                </button>

                {changelistState.mode === 'changes' && (
                    <>
                        <button
                            className={styles.iconBtn}
                            title={t('Create Changelist')}
                            onClick={async () => {
                                await rpc.createChangelist();
                                rpcEvents.refresh.emit();
                            }}
                        >
                            <i className="codicon codicon-add"></i>
                        </button>
                        <div className={styles.toolbarSeparator}></div>
                    </>
                )}

                {changelistState.mode === 'staged' && (
                    <>
                        <button className={styles.iconBtn} title={t('Stash')} onClick={() => rpc.stash({ files: Array.from(selectedFiles), stagedOnly: true })} disabled={selectedFiles.size === 0}>
                            <i className="codicon codicon-archive"></i>
                        </button>
                        <button
                            className={styles.iconBtn}
                            title={t('Stage All Tracked')}
                            onClick={async () => {
                                await rpc.stageTracked();
                                rpcEvents.refresh.emit();
                            }}
                            disabled={!hasTrackedChanges}
                        >
                            <i className="codicon codicon-add"></i>
                        </button>
                        <div className={styles.toolbarSeparator}></div>
                    </>
                )}

                <button className={styles.iconBtn} title={t('Expand All')} onClick={onExpandAll}>
                    <i className="codicon codicon-expand-all"></i>
                </button>
                <button className={styles.iconBtn} title={t('Collapse All')} onClick={onCollapseAll}>
                    <i className="codicon codicon-collapse-all"></i>
                </button>
                <div className={styles.toolbarSeparator}></div>
                <ViewModeToggle viewMode={viewMode} onChange={onViewModeChange} />
            </div>
        </div>
    );
}
