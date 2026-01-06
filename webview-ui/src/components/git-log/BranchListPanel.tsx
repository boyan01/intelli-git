import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { BranchListData, LocalBranchInfo } from '../../../../shared/messages';
import { rpc } from '../../lib/rpc_client';
import { usePersistedState } from '../../hooks/usePersistedState';
import { BasicTreeView, type TreeNode, type BasicTreeViewRef } from '../common/BasicTreeView';
import { BranchStatus } from '../common/BranchStatus';
import styles from './BranchListPanel.module.css';
import treeStyles from '../common/BasicTreeView.module.css';

// Priority branches that should be sorted first
const PRIORITY_BRANCHES = ['main', 'master', 'develop', 'dev'];

interface BranchNodeData {
    type: 'head' | 'local' | 'remote' | 'tag' | 'folder';
    fullPath: string;
    branchInfo?: LocalBranchInfo;
}

interface BranchListPanelProps {
    onBranchDoubleClick?: (branch: string) => void;
}

export const BranchListPanel: React.FC<BranchListPanelProps> = ({ onBranchDoubleClick }) => {
    const { t } = useTranslation();
    const [data, setData] = useState<BranchListData | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const treeRef = useRef<BasicTreeViewRef>(null);

    const [expandedIds, setExpandedIds] = usePersistedState('branchList.expandedIds');
    const [selectedId, setSelectedId] = usePersistedState('branchList.selectedId');
    const [filterText, setFilterText] = usePersistedState('branchList.filterText');

    useEffect(() => {
        loadData();
        const interval = setInterval(loadData, 30000);
        return () => clearInterval(interval);
    }, []);

    const loadData = async () => {
        setIsLoading(true);
        try {
            const listData = await rpc.getBranchListData();
            setData(listData);
        } catch (e) {
            console.error('Failed to load branch list', e);
        } finally {
            setIsLoading(false);
        }
    };

    const handleToggle = useCallback((id: string, expanded: boolean) => {
        setExpandedIds(prev => {
            const next = new Set(prev);
            if (expanded) {
                next.add(id);
            } else {
                next.delete(id);
            }
            return next;
        });
    }, [setExpandedIds]);

    const handleSelect = useCallback((node: TreeNode<BranchNodeData>) => {
        setSelectedId(node.id);
    }, [setSelectedId]);

    const handleDoubleClick = useCallback((node: TreeNode<BranchNodeData>) => {
        if (node.data?.type !== 'folder') {
            onBranchDoubleClick?.(node.data?.fullPath || node.id);
        }
    }, [onBranchDoubleClick]);

    // Sort branches with priority branches first
    const sortBranchNames = useCallback((names: string[]): string[] => {
        return [...names].sort((a, b) => {
            const aBaseName = a.split('/').pop()?.toLowerCase() || a.toLowerCase();
            const bBaseName = b.split('/').pop()?.toLowerCase() || b.toLowerCase();

            const aIndex = PRIORITY_BRANCHES.indexOf(aBaseName);
            const bIndex = PRIORITY_BRANCHES.indexOf(bBaseName);

            if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
            if (aIndex !== -1) return -1;
            if (bIndex !== -1) return 1;
            return a.localeCompare(b);
        });
    }, []);

    // Filter items by filter text
    const filterItems = useCallback((items: string[], filter: string): string[] => {
        if (!filter) return items;
        return items.filter(i => i.toLowerCase().includes(filter.toLowerCase()));
    }, []);

    // Get branch info for local branches
    const getBranchInfo = useCallback((branchName: string): LocalBranchInfo | undefined => {
        return data?.localBranchesInfo?.find(info => info.name === branchName);
    }, [data]);

    // Build tree nodes from branch list
    const buildBranchTree = useCallback((
        branches: string[],
        idPrefix: string,
        type: 'local' | 'remote' | 'tag',
        remoteName?: string
    ): TreeNode<BranchNodeData>[] => {
        // Build hierarchical structure
        interface TempNode {
            name: string;
            path: string;
            children: Map<string, TempNode>;
            isLeaf: boolean;
        }

        const root = new Map<string, TempNode>();

        for (const branch of branches) {
            const parts = branch.split('/');
            let currentLevel = root;

            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                const isLast = i === parts.length - 1;
                const path = parts.slice(0, i + 1).join('/');

                if (!currentLevel.has(part)) {
                    currentLevel.set(part, {
                        name: part,
                        path: path,
                        children: new Map(),
                        isLeaf: isLast
                    });
                }

                if (!isLast) {
                    currentLevel = currentLevel.get(part)!.children;
                }
            }
        }

        // Convert to TreeNode, sorted
        const convertToTreeNodes = (nodes: Map<string, TempNode>, depth: number): TreeNode<BranchNodeData>[] => {
            const entries = Array.from(nodes.entries());

            // Sort: folders first, then priority branches, then alphabetical
            entries.sort(([aKey, aNode], [bKey, bNode]) => {
                if (!aNode.isLeaf && bNode.isLeaf) return -1;
                if (aNode.isLeaf && !bNode.isLeaf) return 1;

                if (aNode.isLeaf && bNode.isLeaf) {
                    const aIndex = PRIORITY_BRANCHES.indexOf(aKey.toLowerCase());
                    const bIndex = PRIORITY_BRANCHES.indexOf(bKey.toLowerCase());
                    if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
                    if (aIndex !== -1) return -1;
                    if (bIndex !== -1) return 1;
                }

                return aKey.localeCompare(bKey);
            });

            return entries.map(([, node]) => {
                const nodeId = `${idPrefix}/${node.path}`;
                const fullPath = type === 'remote' && remoteName
                    ? `${remoteName}/${node.path}`
                    : node.path;

                if (node.isLeaf) {
                    const branchInfo = type === 'local' ? getBranchInfo(node.path) : undefined;
                    return {
                        id: nodeId,
                        label: node.name,
                        title: fullPath,
                        icon: type === 'tag' ? 'tag' : 'git-branch',
                        data: {
                            type,
                            fullPath,
                            branchInfo
                        }
                    };
                } else {
                    return {
                        id: nodeId,
                        label: node.name,
                        icon: 'folder',
                        children: convertToTreeNodes(node.children, depth + 1),
                        data: {
                            type: 'folder' as const,
                            fullPath
                        }
                    };
                }
            });
        };

        return convertToTreeNodes(root, 0);
    }, [getBranchInfo]);

    // Build complete tree structure
    const treeNodes = useMemo((): TreeNode<BranchNodeData>[] => {
        if (!data) return [];

        const nodes: TreeNode<BranchNodeData>[] = [];

        // HEAD
        nodes.push({
            id: 'head',
            label: `${t('HEAD')} (${data.currentBranch})`,
            icon: 'target',
            data: { type: 'head', fullPath: 'HEAD' }
        });

        // Local Branches
        const filteredLocal = filterItems(data.localBranches, filterText);
        const localChildren = buildBranchTree(sortBranchNames(filteredLocal), 'local', 'local');
        nodes.push({
            id: 'local',
            label: t('Local'),
            children: localChildren,
            data: { type: 'folder', fullPath: '' }
        });

        // Remote Branches
        const remoteChildren: TreeNode<BranchNodeData>[] = [];
        for (const [remote, branches] of Object.entries(data.remoteBranches).sort(([a], [b]) => a.localeCompare(b))) {
            const filteredBranches = filterItems(branches, filterText);
            if (filteredBranches.length === 0 && filterText) continue;

            const remoteBranchNodes = buildBranchTree(sortBranchNames(filteredBranches), `remote/${remote}`, 'remote', remote);
            remoteChildren.push({
                id: `remote/${remote}`,
                label: remote,
                icon: 'cloud',
                children: remoteBranchNodes,
                data: { type: 'folder', fullPath: remote }
            });
        }
        nodes.push({
            id: 'remote',
            label: t('Remote'),
            children: remoteChildren,
            data: { type: 'folder', fullPath: '' }
        });

        // Tags
        const filteredTags = filterItems(data.tags, filterText);
        const tagNodes = filteredTags.map(tag => ({
            id: `tag/${tag}`,
            label: tag,
            icon: 'tag',
            data: { type: 'tag' as const, fullPath: `tag/${tag}` }
        }));
        nodes.push({
            id: 'tags',
            label: t('Tags'),
            children: tagNodes,
            data: { type: 'folder', fullPath: '' }
        });

        return nodes;
    }, [data, filterText, t, filterItems, sortBranchNames, buildBranchTree]);

    // When filter text changes, expand all
    const effectiveExpandedIds = useMemo(() => {
        if (filterText) {
            // Expand all when filtering
            const allIds = new Set<string>();
            const traverse = (nodes: TreeNode<BranchNodeData>[]) => {
                for (const node of nodes) {
                    if (node.children) {
                        allIds.add(node.id);
                        traverse(node.children);
                    }
                }
            };
            traverse(treeNodes);
            return allIds;
        }
        return expandedIds;
    }, [filterText, expandedIds, treeNodes]);

    // Render label with highlight
    const renderLabel = useCallback((node: TreeNode<BranchNodeData>) => {
        if (!filterText || !node.label.toLowerCase().includes(filterText.toLowerCase())) {
            return node.label;
        }

        const parts: React.ReactNode[] = [];
        const regex = new RegExp(`(${filterText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');

        let lastIndex = 0;
        let match;

        while ((match = regex.exec(node.label)) !== null) {
            if (match.index > lastIndex) {
                parts.push(node.label.substring(lastIndex, match.index));
            }
            parts.push(<span key={match.index} className={treeStyles.highlight}>{match[0]}</span>);
            lastIndex = match.index + match[0].length;
        }

        if (lastIndex < node.label.length) {
            parts.push(node.label.substring(lastIndex));
        }

        return <>{parts}</>;
    }, [filterText]);

    // Render trailing (ahead/behind indicator)
    const renderTrailing = useCallback((node: TreeNode<BranchNodeData>) => {
        const info = node.data?.branchInfo;
        if (!info || (info.ahead === 0 && info.behind === 0)) {
            return null;
        }

        return (
            <BranchStatus ahead={info.ahead} behind={info.behind} />
        );
    }, []);

    // Get context data for context menu
    const getContextData = useCallback((node: TreeNode<BranchNodeData>) => {
        if (!node.data || node.data.type === 'folder') return undefined;

        if (node.data.type === 'local') {
            return {
                webviewSection: 'localBranch',
                branchName: node.data.fullPath,
                fullBranchName: node.data.fullPath
            };
        }
        if (node.data.type === 'remote') {
            return {
                webviewSection: 'remoteBranch',
                branchName: node.data.fullPath,
                fullBranchName: node.data.fullPath
            };
        }
        if (node.data.type === 'tag') {
            return {
                webviewSection: 'tag',
                tagName: node.data.fullPath.replace('tag/', '')
            };
        }
        return undefined;
    }, []);

    if (!data && isLoading) return <div className={styles.container}>Loading branches...</div>;
    if (!data) return <div className={styles.container}>No data</div>;

    return (
        <div className={styles.container}>
            <div className={styles.searchContainer}>
                <input
                    type="text"
                    className={styles.searchInput}
                    placeholder={t('Filter branches...')}
                    value={filterText}
                    onChange={(e) => setFilterText(e.target.value)}
                />
                <button
                    className={styles.toolbarButton}
                    onClick={() => treeRef.current?.expandAll()}
                    title="Expand all"
                >
                    <i className="codicon codicon-expand-all" />
                </button>
                <button
                    className={styles.toolbarButton}
                    onClick={() => treeRef.current?.collapseAll()}
                    title="Collapse all"
                >
                    <i className="codicon codicon-collapse-all" />
                </button>
            </div>

            <div className={styles.treeContainer}>
                <BasicTreeView
                    ref={treeRef}
                    nodes={treeNodes}
                    expandedIds={effectiveExpandedIds}
                    selectedId={selectedId ?? undefined}
                    onToggle={handleToggle}
                    onSelect={handleSelect}
                    onDoubleClick={handleDoubleClick}
                    renderLabel={renderLabel}
                    renderTrailing={renderTrailing}
                    getContextData={getContextData}
                />
            </div>
        </div>
    );
};
