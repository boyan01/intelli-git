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
    const [branches, setBranches] = useState<BranchInfo | null>(null);
    const [stashList, setStashList] = useState<StashItem[]>([]);
    const [activeFile, setActiveFile] = useState<string | null>(null);

    useEffect(() => {
        const handleMessage = (event: MessageEvent<CommitViewExtMessage>) => {
            const message = event.data;
            switch (message.type) {
                case 'update':
                    setChangelists(message.files);
                    setBranches(message.branches);
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
        vscode.postMessage({ type: 'refresh' });
        vscode.postMessage({ type: 'getStashList' });
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    return {
        changelists,
        branches,
        stashList,
        activeFile
    };
};
