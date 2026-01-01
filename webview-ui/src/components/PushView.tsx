import { useState, useEffect, useCallback } from 'react';
import type { CommitInfo, CommitFile, PushConfig, PushViewMessage, PushViewExtMessage, FileStatus } from '@shared/messages';
import { FileTree } from './FileTree';
import { vscode } from '../lib/vscode';

export function PushView() {
    const postMessage = useCallback((message: PushViewMessage) => {
        vscode.postMessage(message);
    }, []);
    
    const [commits, setCommits] = useState<CommitInfo[]>([]);
    const [files, setFiles] = useState<CommitFile[]>([]);
    const [config, setConfig] = useState<PushConfig | null>(null);
    const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null);
    const [pushTags, setPushTags] = useState(false);
    const [isPushing, setIsPushing] = useState(false);
    const [isForcePushExpanded, setIsForcePushExpanded] = useState(false);

    useEffect(() => {
        const handleMessage = (event: MessageEvent<PushViewExtMessage>) => {
            const message = event.data;
            switch (message.type) {
                case 'update': 
                    setCommits(message.commits);
                    setFiles(message.files);
                    setConfig(message.config);
                    if (message.commits.length > 0 && !selectedCommitHash) {
                        setSelectedCommitHash(message.commits[0].hash);
                    }
                    break;
                case 'updateFiles':
                    setFiles(message.files);
                    break;
                case 'pushComplete':
                    setIsPushing(false);
                    break;
                case 'pushError':
                    setIsPushing(false);
                    break;
            }
        };

        window.addEventListener('message', handleMessage);
        postMessage({ type: 'ready' });
        return () => window.removeEventListener('message', handleMessage);
    }, [selectedCommitHash, postMessage]);

    const handlePush = (force: boolean) => {
        setIsPushing(true);
        postMessage({ type: 'push', force, pushTags });
    };

    const handleSelectCommit = (index: number, hash: string) => {
        setSelectedCommitHash(hash);
        postMessage({ type: 'selectCommit', index });
    };

    const handleRemoteChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        if (!config) return;
        postMessage({ type: 'changeRemote', remote: e.target.value });
    };

    const handleRemoteBranchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!config) return;
        postMessage({ type: 'changeRemoteBranch', branch: e.target.value });
    };

    if (!config) {
        return <div className="loading-overlay"><div className="loading-spinner"></div></div>;
    }

    const selectedCommit = commits.find(c => c.hash === selectedCommitHash);

    // Convert CommitFiles to FileStatus for FileTree (ignoring staged/status complexity for now, just path/status)
    const fileStatusList: FileStatus[] = files.map(f => ({
        path: f.path,
        status: f.status,
        staged: true // irrelevant for readonly tree
    }));

    return (
        <div className="push-panel">
            <div className="push-header">
                <h2>Push commits</h2>
                <button className="header-close-btn" onClick={() => postMessage({ type: 'cancel' })} title="Close">
                    <i className="codicon codicon-close"></i>
                </button>
            </div>

            <div className="push-main">
                {/* Left: Commits Panel */}
                <div className="commits-panel">
                    <div className="commits-header">
                        <div className="branch-flow">
                            <span className="local-branch">{config.currentBranch}</span>
                            <span className="arrow">→</span>
                            <div className="remote-selector">
                                <select 
                                    className="branch-select" 
                                    value={config.remote}
                                    onChange={handleRemoteChange}
                                >
                                    {config.remotes.map(r => (
                                        <option key={r} value={r}>{r}</option>
                                    ))}
                                </select>
                                <span className="separator">:</span>
                                <div className="branch-input-wrapper">
                                    <input 
                                        type="text" 
                                        className="branch-input"
                                        defaultValue={config.remoteBranch}
                                        onBlur={handleRemoteBranchChange}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleRemoteBranchChange(e as any);
                                        }}
                                        placeholder="branch name"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="commits-list">
                        {commits.map((commit, index) => (
                            <div 
                                key={commit.hash}
                                className={`commit-item ${selectedCommitHash === commit.hash ? 'selected' : ''}`}
                                onClick={() => handleSelectCommit(index, commit.hash)}
                            >
                                <div className="commit-message" title={commit.subject}>{commit.subject}</div>
                                <div className="commit-meta">
                                    <span className="commit-hash">{commit.shortHash}</span>
                                    <span className="commit-date">{commit.date}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Right: Files + Details */}
                <div className="files-panel">
                    {/* Top: File List */}
                    <div className="files-view-container">
                        <div className="files-toolbar">
                            <div className="toolbar-left">
                                <span className="files-count">{files.length} files</span>
                            </div>
                        </div>
                        <div className="files-tree-wrapper">
                            <FileTree 
                                files={fileStatusList} 
                                viewMode="tree" 
                                selectedFiles={new Set()} 
                                onToggleFile={() => {}} 
                                readonly={true}
                                initiallyExpanded={true}
                            />
                        </div>
                    </div>

                    {/* Bottom: Commit Details */}
                    {selectedCommit && (
                        <div className="commit-details-pane">
                            <div className="details-header">Commit Details</div>
                            <div className="details-content">
                                <div className="detail-row author">
                                    <span className="label">Author:</span>
                                    <span className="value">{selectedCommit.authorName}</span>
                                </div>
                                <div className="detail-row hash">
                                    <span className="label">Hash:</span>
                                    <span className="value">{selectedCommit.hash}</span>
                                </div>
                                <div className="detail-row date">
                                    <span className="label">Date:</span>
                                    <span className="value">{selectedCommit.date}</span>
                                </div>
                                <div className="detail-message">
                                    {selectedCommit.subject}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className="push-footer">
                <div className="footer-left">
                    <div className="push-tags-group">
                        <label>
                            <input 
                                type="checkbox" 
                                checked={pushTags}
                                onChange={e => setPushTags(e.target.checked)}
                            />
                            Push tags
                        </label>
                    </div>
                </div>
                <div className="footer-right">
                    <button className="btn btn-secondary" onClick={() => postMessage({ type: 'cancel' })}>Cancel</button>
                    <div className="btn-split" style={{ position: 'relative' }}>
                        <button className="btn btn-primary btn-main" onClick={() => handlePush(false)}>Push</button>
                        <button 
                            className="btn btn-primary btn-dropdown"
                            onClick={() => setIsForcePushExpanded(!isForcePushExpanded)}
                        >
                            <i className="codicon codicon-chevron-down"></i>
                        </button>
                        {isForcePushExpanded && (
                            <div className="dropdown-menu" style={{ display: 'block', bottom: '100%', top: 'auto' }}>
                                <div className="dropdown-item" onClick={() => {
                                    handlePush(true);
                                    setIsForcePushExpanded(false);
                                }}>
                                    <i className="codicon codicon-warning icon"></i>
                                    <span>Force Push</span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {isPushing && (
                <div className="loading-overlay">
                    <div className="loading-spinner"></div>
                </div>
            )}
        </div>
    );
}
