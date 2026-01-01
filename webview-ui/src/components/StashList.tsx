import { logger } from '@/lib/log';
import type { StashItem } from '@shared/messages';

interface StashListProps {
    stashes: StashItem[]; 
    onAction: (action: 'apply' | 'pop' | 'drop', stashIndex: number) => void;
}

export const StashList: React.FC<StashListProps> = ({ stashes, onAction }) => {

    logger.log("stashLis1t", stashes);

    if (!stashes || stashes.length === 0) {
        return <div className="empty-state">没有贮藏</div>;
    }

    return (
        <div className="stash-list">
            {stashes.map((stash) => (
                <div key={stash.index} className="stash-item">
                    <div className="stash-item-header">
                        <span className="codicon codicon-chevron-right stash-item-expand"></span>
                        <div style={{ flex: 1, overflow: 'hidden' }}>
                            <div className="stash-item-name">{stash.message || `Stash@{${stash.index}}`}</div>
                            <div className="stash-item-branch">
                                <i className="codicon codicon-git-branch"></i>
                                <span>{stash.branch || 'HEAD'}</span>
                            </div>
                        </div>
                        <div className="stash-actions">
                            <button className="icon-btn" title="Pop" onClick={() => onAction('pop', stash.index)}>
                                <i className="codicon codicon-reply"></i>
                            </button>
                            <button className="icon-btn" title="Drop" onClick={() => onAction('drop', stash.index)}>
                                <i className="codicon codicon-trash"></i>
                            </button>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
};
