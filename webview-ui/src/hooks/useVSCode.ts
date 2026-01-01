import { useEffect, useState, useCallback } from 'react';
import type { ChangelistGroup, BranchInfo } from '../types';

// Type for the VS Code API
interface VSCodeApi {
    postMessage: (msg: any) => void;
    getState: () => any;
    setState: (state: any) => void;
}

// Acquire the API once
const vscode: VSCodeApi = (window as any).acquireVsCodeApi 
    ? (window as any).acquireVsCodeApi()
    : {
        postMessage: (msg: any) => console.log('VS Code Message:', msg),
        getState: () => ({}),
        setState: (state: any) => console.log('Set State:', state),
    };

export const useVSCode = () => {
    const [changelists, setChangelists] = useState<ChangelistGroup[]>([]);
    const [branches, setBranches] = useState<BranchInfo | null>(null);
    const [stashList, setStashList] = useState<any[]>([]);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.type) {
                case 'update':
                    setChangelists(message.files);
                    setBranches(message.branches);
                    break;
                case 'stash-update':
                    setStashList(message.list);
                    break;
            }
        };

        window.addEventListener('message', handleMessage);
        
        // Signal ready
        vscode.postMessage({ command: 'refresh' });

        return () => window.removeEventListener('message', handleMessage);
    }, []);

    const postMessage = useCallback((message: any) => {
        vscode.postMessage(message);
    }, []);

    return {
        changelists,
        branches,
        stashList,
        postMessage
    };
};
