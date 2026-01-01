import React from 'react';
// import { VSCodeButton, VSCodeCheckbox, VSCodeTextArea } from '@vscode/webview-ui-toolkit/react';

interface CommitFormProps {
    message: string;
    amend: boolean;
    onMessageChange: (msg: string) => void;
    onAmendChange: (amend: boolean) => void;
    onCommit: (push: boolean) => void;
}

export const CommitForm: React.FC<CommitFormProps> = ({ 
    message, 
    amend, 
    onMessageChange, 
    onAmendChange, 
    onCommit 
}) => {
    return (
        <div className="commit-section">
            <div className="commit-toolbar">
                <label className="amend-label" style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                    <input 
                        type="checkbox" 
                        checked={amend} 
                        onChange={(e) => onAmendChange(e.target.checked)}
                        style={{ margin: 0, marginRight: '4px' }}
                    />
                    <span>修正(M)</span>
                </label>
            </div>
            
            <textarea
                value={message}
                onChange={(e) => onMessageChange(e.target.value)}
                placeholder="提交信息"
                rows={4}
                style={{
                    width: 'calc(100% - 16px)',
                    minHeight: '80px',
                    padding: '8px',
                    margin: '8px',
                    resize: 'vertical',
                    background: 'var(--vscode-input-background)',
                    color: 'var(--vscode-input-foreground)',
                    border: '1px solid var(--vscode-input-border)',
                    borderRadius: '4px',
                    fontFamily: 'var(--vscode-font-family)'
                }}
            />

            <div className="footer-actions">
                <div className="actions-left">
                    <button 
                        className="btn btn-primary" 
                        onClick={() => onCommit(false)}
                    >
                        提交(I)
                    </button>
                    <button 
                        className="btn btn-secondary" 
                        onClick={() => onCommit(true)}
                    >
                        提交并推送(P)...
                    </button>
                </div>
                <div className="actions-right">
                    <button className="icon-btn" title="设置">
                        <i className="codicon codicon-settings-gear"></i>
                    </button>
                </div>
            </div>
        </div>
    );
};
