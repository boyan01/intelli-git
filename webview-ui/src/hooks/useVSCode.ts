import { useEffect, useState, useCallback } from 'react';
import type { 
    ChangelistGroup, 
    BranchInfo, 
    StashItem,
    WebviewMessage,
    CommitViewExtMessage,
} from '@shared/messages';
import { vscode } from '../lib/vscode';

export const useVSCode = () => {
    const [changelists, setChangelists] = useState<ChangelistGroup[]>([]);
    const [branches, setBranches] = useState<BranchInfo | null>(null);
    const [stashList, setStashList] = useState<StashItem[]>([]);

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
            }
        };

        window.addEventListener('message', handleMessage);
        vscode.postMessage({ type: 'refresh' });
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    const postMessage = useCallback((message: WebviewMessage) => {
        vscode.postMessage(message);
    }, []);

    return {
        changelists,
        branches,
        stashList,
        postMessage
    };
};
