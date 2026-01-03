import React, { useState, useEffect } from 'react';
import type { CommitDetails, CommitFile } from '../../../../shared/messages';
import { rpc } from '../../lib/rpc_client';

interface CommitDetailsPanelProps {
    commitHash: string | null;
}

const styles = {
    container: {
        height: '100%',
        display: 'flex',
        flexDirection: 'column' as const,
        overflow: 'hidden',
        fontSize: '13px',
    },
    header: {
        padding: '8px 16px',
        borderBottom: '1px solid var(--vscode-panel-border)',
        flexShrink: 0,
    },
    message: {
        fontSize: '14px',
        fontWeight: 'bold' as const,
        marginBottom: '8px',
        whiteSpace: 'pre-wrap' as const,
    },
    meta: {
        color: 'var(--vscode-descriptionForeground)',
        lineHeight: '1.5',
    },
    fileList: {
        flex: 1,
        overflow: 'auto',
        padding: '0',
    },
    fileRow: {
        display: 'flex',
        alignItems: 'center',
        padding: '4px 16px',
        cursor: 'pointer',
    },
    fileStatus: {
        width: '16px',
        textAlign: 'center' as const,
        marginRight: '8px',
        fontWeight: 'bold' as const,
    },
    filePath: {
        flex: 1,
        textOverflow: 'ellipsis',
        overflow: 'hidden',
        whiteSpace: 'nowrap' as const,
    },
    statusA: { color: 'var(--vscode-gitDecoration-addedResourceForeground)' },
    statusM: { color: 'var(--vscode-gitDecoration-modifiedResourceForeground)' },
    statusD: { color: 'var(--vscode-gitDecoration-deletedResourceForeground)' },
    statusR: { color: 'var(--vscode-gitDecoration-renamedResourceForeground)' },
    empty: {
        padding: '16px',
        color: 'var(--vscode-descriptionForeground)',
        textAlign: 'center' as const,
    }
};

const StatusIcon: React.FC<{ status: string }> = ({ status }) => {
    let style = {};
    let label = status;

    if (status.startsWith('A')) style = styles.statusA;
    else if (status.startsWith('M')) style = styles.statusM;
    else if (status.startsWith('D')) style = styles.statusD;
    else if (status.startsWith('R')) style = styles.statusR;

    return <span style={{ ...styles.fileStatus, ...style }}>{label[0]}</span>;
};

export const CommitDetailsPanel: React.FC<CommitDetailsPanelProps> = ({ commitHash }) => {
    const [details, setDetails] = useState<CommitDetails | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!commitHash) {
            setDetails(null);
            return;
        }

        const fetchDetails = async () => {
            setLoading(true);
            try {
                const result = await rpc.getCommitDetails(commitHash);
                setDetails(result);
            } catch (error) {
                console.error('Failed to load commit details', error);
                setDetails(null);
            } finally {
                setLoading(false);
            }
        };

        fetchDetails();
    }, [commitHash]);

    const handleFileDoubleClick = async (file: CommitFile) => {
        if (!details) return;

        const parentHash = details.parentHashes.length > 0 ? details.parentHashes[0] : '';
        const currentHash = details.hash;

        let leftRef = parentHash;
        let rightRef = currentHash;

        if (file.status.startsWith('A')) {
            leftRef = ''; // Diff against empty
        } else if (file.status.startsWith('D')) {
            rightRef = ''; // Diff against empty (or effectively show deleted content in left)
        }

        await rpc.openCommitDiff({
            path: file.path,
            leftRef,
            rightRef
        });
    };

    if (!commitHash) {
        return <div style={styles.empty}>Select a commit to view details</div>;
    }

    if (loading) {
        return <div style={styles.empty}>Loading details...</div>;
    }

    if (!details) {
        return <div style={styles.empty}>No details available</div>;
    }

    return (
        <div style={styles.container}>
            <div style={styles.header}>
                <div style={styles.message}>{details.fullMessage}</div>
                <div style={styles.meta}>
                    Commit: {details.hash}<br />
                    Parents: {details.parentHashes.map(h => h.substring(0, 8)).join(', ')}<br />
                    {details.stats && (
                        <span>
                            {details.files.length} files changed
                            (+{details.stats.additions}, -{details.stats.deletions})
                        </span>
                    )}
                </div>
            </div>
            <div style={styles.fileList}>
                {details.files.map((file, index) => (
                    <div
                        key={index}
                        style={styles.fileRow}
                        className="file-row" // For CSS hover if needed, or implement in JS
                        onDoubleClick={() => handleFileDoubleClick(file)}
                    >
                        <StatusIcon status={file.status} />
                        <span style={styles.filePath} title={file.path}>{file.path}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};
