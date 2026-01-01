import { useEffect, useState } from 'react';
import type {
    ChangelistGroup,
    BranchInfo,
    StashItem,
    CommitViewExtMessage,
} from '@shared/messages';
import { vscode } from '@/lib/vscode';
import { logger } from '@/lib/log';

export const useVSCode = () => {
    const [changelists, setChangelists] = useState<ChangelistGroup[]>([]);
    const [branches, setBranches] = useState<BranchInfo>({ current: '', all: [], ahead: 0, behind: 0, rebaseStatus: 'none' });
    const [stashList, setStashList] = useState<StashItem[]>([]);
    const [activeFile, setActiveFile] = useState<string | null>(null);
    const [incomingCommits, setIncomingCommits] = useState(0);

    useEffect(() => {
        // Initial load
        vscode.postMessage({ type: 'refresh' });
        vscode.postMessage({ type: 'getStashList' });

        const handleMessage = (event: MessageEvent<CommitViewExtMessage>) => {
            const message = event.data;
            switch (message.type) {
                case 'update':
                    setChangelists(message.files);
                    if (message.branches) {
                        setBranches(message.branches);
                    }
                    if (typeof message.incomingCommits === 'number') {
                        setIncomingCommits(message.incomingCommits);
                    }
                    break;
                case 'stashList':
                    setStashList(message.stashList);
                    break;
                case 'activeFileChange':
                    logger.log('activeFileChange', message.path);
                    setActiveFile(message.path);
                    break;
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    return {
        changelists,
        stashList,
        activeFile,
        branches,
        incomingCommits
    };
};
