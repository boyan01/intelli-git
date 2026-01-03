import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { BranchListData } from '../../../../shared/messages';
import { rpc } from '../../lib/rpc_client';
import { usePersistedState } from '../../hooks/usePersistedState';
import { BranchTreeNode } from './BranchTreeNode';
import styles from './BranchListPanel.module.css';

interface BranchNode {
    name: string;
    path: string;
    children: Record<string, BranchNode>;
}

export const BranchListPanel: React.FC = () => {
    const { t } = useTranslation();
    const [data, setData] = useState<BranchListData | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    // Persisted state
    const [expandedGroups, setExpandedGroups] = usePersistedState('branchList.expandedGroups');
    const [selectedBranch, setSelectedBranch] = usePersistedState('branchList.selectedBranch');
    const [filterText, setFilterText] = usePersistedState('branchList.filterText');

    useEffect(() => {
        loadData();
        const interval = setInterval(loadData, 30000); // Auto-refresh every 30s
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

    const toggleGroup = (groupKey: string) => {
        setExpandedGroups(prev => {
            const next = new Set(prev);
            if (next.has(groupKey)) {
                next.delete(groupKey);
            } else {
                next.add(groupKey);
            }
            return next;
        });
    };

    const isGroupExpanded = (key: string) => expandedGroups.has(key);

    const handleSelect = (branch: string, _isRemote: boolean) => {
        setSelectedBranch(branch);
    };

    // Helper to build tree structure from list of strings
    const buildTree = useCallback((items: string[]): Record<string, BranchNode> => {
        const root: Record<string, BranchNode> = {};

        items.forEach(item => {
            const parts = item.split('/');
            let currentLevel = root;
            parts.forEach((part, index) => {
                const isItem = index === parts.length - 1;
                const path = parts.slice(0, index + 1).join('/');

                if (!currentLevel[part]) {
                    currentLevel[part] = {
                        name: part,
                        path: path,
                        children: {}
                    };
                }

                if (!isItem) {
                    currentLevel = currentLevel[part].children;
                }
            });
        });

        return root;
    }, []);

    const filterItems = useCallback((items: string[], filter: string) => {
        if (!filter) return items;
        return items.filter(i => i.toLowerCase().includes(filter.toLowerCase()));
    }, []);

    const renderTreeNodes = (nodes: Record<string, BranchNode>, level: number, prefix: string, isRemote: boolean) => {
        const sortedKeys = Object.keys(nodes).sort((a, b) => {
            const aIsLeaf = Object.keys(nodes[a].children).length === 0;
            const bIsLeaf = Object.keys(nodes[b].children).length === 0;
            if (aIsLeaf && !bIsLeaf) return 1; // Folders first
            if (!aIsLeaf && bIsLeaf) return -1;
            return a.localeCompare(b);
        });

        return sortedKeys.map(key => {
            const node = nodes[key];
            const hasChildren = Object.keys(node.children).length > 0;
            const groupKey = `${prefix}/${node.path}`;
            const isExpanded = isGroupExpanded(groupKey) || !!filterText;

            if (hasChildren) {
                return (
                    <React.Fragment key={groupKey}>
                        <BranchTreeNode
                            label={node.name}
                            level={level}
                            isExpanded={isExpanded}
                            isLeaf={false}
                            icon="folder"
                            onToggle={() => toggleGroup(groupKey)}
                        />
                        {isExpanded && renderTreeNodes(node.children, level + 1, prefix, isRemote)}
                    </React.Fragment>
                );
            } else {
                return (
                    <BranchTreeNode
                        key={groupKey}
                        label={node.name}
                        level={level}
                        isLeaf={true}
                        isSelected={selectedBranch === (isRemote ? `${prefix}/${node.path}` : node.path)}
                        highlightMatch={filterText}
                        icon="git-branch"
                        onSelect={() => handleSelect(isRemote ? `${prefix}/${node.path}` : node.path, isRemote)}
                        contextMenuParams={{
                            webviewSection: isRemote ? 'remoteBranch' : 'localBranch',
                            branchName: node.path,
                            fullBranchName: isRemote ? `${prefix}/${node.path}` : node.path
                        }}
                    />
                );
            }
        });
    };

    // Filter and Build Trees
    const localTree = useMemo(() => {
        if (!data) return {};
        const filtered = filterItems(data.localBranches, filterText);
        return buildTree(filtered);
    }, [data, filterText, buildTree, filterItems]);

    // Render content
    if (!data && isLoading) return <div className={styles.container}>Loading branches...</div>;
    if (!data) return <div className={styles.container}>No data</div>;

    return (
        <div className={styles.container}>
            <div className={styles.searchContainer}>
                <input
                    type="text"
                    className={styles.searchInput}
                    placeholder={t('branchList.filterPlaceholder')}
                    value={filterText}
                    onChange={(e) => setFilterText(e.target.value)}
                />
            </div>

            <div className={styles.treeContainer}>
                {/* HEAD */}
                <BranchTreeNode
                    label={`${t('branchList.head')} (${data.currentBranch})`}
                    level={0}
                    isLeaf={true}
                    isSelected={selectedBranch === 'HEAD'}
                    icon="target"
                    onSelect={() => handleSelect('HEAD', false)}
                />

                {/* Local Branches */}
                <BranchTreeNode
                    label={t('branchList.localBranches')}
                    level={0}
                    isLeaf={false}
                    isExpanded={isGroupExpanded('local') || !!filterText}
                    onToggle={() => toggleGroup('local')}
                />
                {(isGroupExpanded('local') || !!filterText) &&
                    renderTreeNodes(localTree, 1, 'local', false)
                }

                {/* Remote Branches */}
                <BranchTreeNode
                    label={t('branchList.remoteBranches')}
                    level={0}
                    isLeaf={false}
                    isExpanded={isGroupExpanded('remote') || !!filterText}
                    onToggle={() => toggleGroup('remote')}
                />
                {(isGroupExpanded('remote') || !!filterText) &&
                    Object.entries(data.remoteBranches).sort(([a], [b]) => a.localeCompare(b)).map(([remote, branches]) => {
                        const filtered = filterItems(branches, filterText);
                        if (filtered.length === 0) return null;
                        const remoteTree = buildTree(filtered);
                        const remoteGroupKey = `remote/${remote}`;

                        return (
                            <React.Fragment key={remote}>
                                <BranchTreeNode
                                    label={remote}
                                    level={1}
                                    isLeaf={false}
                                    isExpanded={isGroupExpanded(remoteGroupKey) || !!filterText}
                                    icon="cloud"
                                    onToggle={() => toggleGroup(remoteGroupKey)}
                                />
                                {(isGroupExpanded(remoteGroupKey) || !!filterText) &&
                                    renderTreeNodes(remoteTree, 2, remote, true)
                                }
                            </React.Fragment>
                        );
                    })
                }

                {/* Tags */}
                <BranchTreeNode
                    label={t('branchList.tags')}
                    level={0}
                    isLeaf={false}
                    isExpanded={isGroupExpanded('tags') || !!filterText}
                    onToggle={() => toggleGroup('tags')}
                />
                {(isGroupExpanded('tags') || !!filterText) &&
                    filterItems(data.tags, filterText).map(tag => (
                        <BranchTreeNode
                            key={`tag/${tag}`}
                            label={tag}
                            level={1}
                            isLeaf={true}
                            icon="tag"
                            highlightMatch={filterText}
                            isSelected={selectedBranch === `tag/${tag}`}
                            onSelect={() => handleSelect(`tag/${tag}`, false)}
                            contextMenuParams={{
                                webviewSection: 'tag',
                                tagName: tag
                            }}
                        />
                    ))
                }
            </div>
        </div>
    );
};
