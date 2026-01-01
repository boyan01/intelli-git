import React from 'react';

// Use 'any' for StashItem for now, or define interface based on GitService
interface StashListProps {
    stashes: any[]; 
    onAction: (action: 'apply' | 'pop' | 'drop', stashIndex: string) => void;
}

export const StashList: React.FC<StashListProps> = ({ stashes, onAction }) => {
    if (!stashes || stashes.length === 0) {
        return <div className="empty-state">没有贮藏</div>;
    }

    return (
        <div className="stash-list">
            {stashes.map((stash, index) => (
                <div key={index} className="stash-item">
                    <div className="stash-item-header">
                        <span className="codicon codicon-chevron-right stash-item-expand"></span>
                        <div style={{ flex: 1, overflow: 'hidden' }}>
                            <div className="stash-item-name">{stash.message || `Stash@{${index}}`}</div>
                            <div className="stash-item-branch">
                                <i className="codicon codicon-git-branch"></i>
                                <span>{stash.branchName || 'HEAD'}</span>
                            </div>
                        </div>
                        <div className="stash-actions">
                            <button className="icon-btn" title="Pop" onClick={() => onAction('pop', `${index}`)}>
                                <i className="codicon codicon-reply"></i>
                            </button>
                            <button className="icon-btn" title="Drop" onClick={() => onAction('drop', `${index}`)}>
                                <i className="codicon codicon-trash"></i>
                            </button>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
};
