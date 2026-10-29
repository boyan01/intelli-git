import type { RefInfo } from '@shared/messages';

export interface RefLabel {
    kind: 'current' | 'local' | 'tag' | 'remote';
    name: string;
    // Remote branches with the same name on the same commit, folded into this local label.
    syncedRemotes: string[];
}

const KIND_PRIORITY: Record<RefLabel['kind'], number> = {
    current: 0,
    local: 1,
    tag: 2,
    remote: 3,
};

function splitRemoteRef(name: string): { remote: string; branch: string } | null {
    const slashIndex = name.indexOf('/');
    if (slashIndex <= 0 || slashIndex === name.length - 1) return null;
    return { remote: name.slice(0, slashIndex), branch: name.slice(slashIndex + 1) };
}

/**
 * Turns raw commit refs into display labels: folds remote branches into the local branch
 * with the same name, hides `<remote>/HEAD`, and orders labels by importance.
 */
export function buildRefLabels(refs: RefInfo[]): RefLabel[] {
    const remotes = refs
        .filter((ref) => ref.type === 'remote')
        .map((ref) => ({ name: ref.name, parts: splitRemoteRef(ref.name) }))
        .filter((remote) => remote.parts?.branch !== 'HEAD');
    const foldedRemotes = new Set<string>();
    const labels: RefLabel[] = [];

    for (const ref of refs) {
        if (ref.type === 'tag') {
            labels.push({ kind: 'tag', name: ref.name, syncedRemotes: [] });
            continue;
        }
        if (ref.type !== 'head' && ref.type !== 'local') continue;

        const syncedRemotes = remotes.filter((remote) => remote.parts?.branch === ref.name).map((remote) => remote.name);
        syncedRemotes.forEach((name) => foldedRemotes.add(name));
        labels.push({ kind: ref.type === 'head' ? 'current' : 'local', name: ref.name, syncedRemotes });
    }

    for (const remote of remotes) {
        if (!foldedRemotes.has(remote.name)) {
            labels.push({ kind: 'remote', name: remote.name, syncedRemotes: [] });
        }
    }

    // Array.prototype.sort is stable, so labels of the same kind keep git's order.
    return labels.sort((a, b) => KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind]);
}
