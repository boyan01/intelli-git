import type { LogCommit } from '@shared/messages';

const BRANCH_COLORS = [
    '#4fc3f7', // Light Blue
    '#81c784', // Green
    '#ffb74d', // Orange
    '#f06292', // Pink
    '#ba68c8', // Purple
    '#4dd0e1', // Cyan
    '#aed581', // Light Green
    '#ff8a65', // Deep Orange
    '#dce775', // Lime
    '#9575cd'  // Deep Purple
];

export const LONG_DISTANCE_THRESHOLD = 30;

export interface GraphLine {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    color: string;
    isMerge: boolean;
    isLongDistance?: boolean;
    targetCommitHash?: string;
    arrowDirection?: 'up' | 'down';
    isDashed?: boolean;
}

export interface GraphNode {
    column: number;
    color: string;
    lines: GraphLine[];
    isMerge: boolean;
    maxX: number;
}

export interface ComputeGraphOptions {
    preferDefaultBranchLane?: boolean;
}

interface LaneInfo {
    targetHash: string;
    sourceRowIndex: number;
    sourceHash: string;
    color: string;
    isResuming?: boolean;
    isDashed?: boolean;
}

interface SuspendedConnection {
    targetHash: string;
    sourceRowIndex: number;
    sourceHash: string;
    originalLane: number;
    color: string;
    isDashed?: boolean;
}

function getDefaultBranchNameRank(name: string): number | null {
    const normalizedName = name.toLowerCase();
    const refName = normalizedName.includes(' -> ')
        ? normalizedName.split(' -> ').pop()?.trim() ?? normalizedName
        : normalizedName;

    if (refName === 'main' || refName === 'origin/main') return 0;
    if (refName === 'master' || refName === 'origin/master') return 1;
    return null;
}

function getDefaultBranchRefRank(ref: LogCommit['refs'][number], hasRemoteHead: boolean): number | null {
    const branchNameRank = getDefaultBranchNameRank(ref.name);
    if (branchNameRank === null || ref.type === 'tag') return null;

    const refRank = ref.type === 'head' || ref.type === 'local'
        ? 0
        : hasRemoteHead ? 1 : 2;

    return branchNameRank * 3 + refRank;
}

function findDefaultBranchTipHash(commits: LogCommit[]): string | null {
    let best: { hash: string; rank: number; commitIndex: number } | null = null;
    const candidates = new Map<string, number>();

    for (let commitIndex = 0; commitIndex < commits.length; commitIndex++) {
        const commit = commits[commitIndex];
        const refs = commit.refs ?? [];
        const hasRemoteHead = refs.some(ref => ref.name.toLowerCase().endsWith('/head'));

        for (const ref of refs) {
            const rank = getDefaultBranchRefRank(ref, hasRemoteHead);
            if (rank === null) continue;
            candidates.set(commit.hash, Math.min(candidates.get(commit.hash) ?? rank, rank));

            if (
                best === null
                || rank < best.rank
                || (rank === best.rank && commitIndex < best.commitIndex)
            ) {
                best = { hash: commit.hash, rank, commitIndex };
            }
        }
    }

    if (!best) return null;

    // A remote tip ahead of the local branch belongs to the same first-parent spine.
    // Keep divergent histories separate, including merges through a second parent.
    const commitByHash = new Map(commits.map(commit => [commit.hash, commit]));
    for (const [candidateHash, rank] of candidates) {
        if (Math.floor(rank / 3) !== Math.floor(best.rank / 3)) continue;
        let currentHash: string | undefined = candidateHash;
        const visited = new Set<string>();
        while (currentHash && !visited.has(currentHash)) {
            if (currentHash === best.hash) return candidateHash;
            visited.add(currentHash);
            currentHash = commitByHash.get(currentHash)?.parentHashes[0];
        }
    }
    return best.hash;
}

function buildDefaultBranchHashes(commits: LogCommit[]): Set<string> {
    const tipHash = findDefaultBranchTipHash(commits);
    const hashes = new Set<string>();
    if (!tipHash) return hashes;

    const commitByHash = new Map(commits.map(commit => [commit.hash, commit]));
    let currentHash: string | undefined = tipHash;
    while (currentHash && !hashes.has(currentHash)) {
        const commit = commitByHash.get(currentHash);
        if (!commit) break;

        hashes.add(currentHash);
        currentHash = commit.parentHashes[0];
    }

    return hashes;
}

export function computeGraph(
    commits: LogCommit[],
    hasMore: boolean = true,
    options: ComputeGraphOptions = {}
): Map<string, GraphNode> {
    const graph = new Map<string, GraphNode>();
    const lanes: (LaneInfo | null)[] = [];
    const arrowColumns = new Set<number>();
    const commitIndexMap = new Map<string, number>();
    const defaultBranchHashes = options.preferDefaultBranchLane ? buildDefaultBranchHashes(commits) : new Set<string>();
    let reserveDefaultLane = defaultBranchHashes.has(commits[0]?.hash);
    let nextColorIndex = defaultBranchHashes.size > 0 ? 1 : 0;
    const allocateColor = (): string => BRANCH_COLORS[nextColorIndex++ % BRANCH_COLORS.length];
    const isDefaultBranchHash = (hash: string | undefined): boolean => !!hash && defaultBranchHashes.has(hash);

    const ensureLaneExists = (index: number): void => {
        while (lanes.length <= index) {
            lanes.push(null);
        }
    };

    const findEmptyLane = (excludedLanes: Set<number> = new Set()): number => {
        ensureLaneExists(reserveDefaultLane ? 1 : 0);

        for (let i = reserveDefaultLane ? 1 : 0; i < lanes.length; i++) {
            if (!excludedLanes.has(i) && !arrowColumns.has(i) && lanes[i] === null) {
                return i;
            }
        }

        ensureLaneExists(lanes.length);
        return lanes.length - 1;
    };

    // Suspended long-distance connections that freed their lane
    const suspendedConnections: SuspendedConnection[] = [];

    commits.forEach((c, i) => commitIndexMap.set(c.hash, i));

    // Detect filtered mode: if any commit has filteredAncestors
    const isFilteredMode = commits.some(c => c.filteredAncestors && c.filteredAncestors.length > 0);

    for (let rowIndex = 0; rowIndex < commits.length; rowIndex++) {
        arrowColumns.clear();
        const commit = commits[rowIndex];
        const { hash, parentHashes: rawParentHashes } = commit;

        // In filtered mode, only consider parents that exist in the list
        const parentHashes = isFilteredMode
            ? rawParentHashes.filter(ph => commitIndexMap.has(ph))
            : rawParentHashes;

        const lines: GraphLine[] = [];
        let maxX = 0;

        // Check if any suspended connections need to reconnect here (at target commit)
        const reconnectingConnections: SuspendedConnection[] = [];
        for (let i = suspendedConnections.length - 1; i >= 0; i--) {
            if (suspendedConnections[i].targetHash === hash) {
                reconnectingConnections.push(suspendedConnections[i]);
                suspendedConnections.splice(i, 1);
            }
        }

        // Check if any suspended connections should resume one row before target
        const resumingConnections: SuspendedConnection[] = [];
        for (let i = suspendedConnections.length - 1; i >= 0; i--) {
            const conn = suspendedConnections[i];
            const targetRowIndex = commitIndexMap.get(conn.targetHash);
            if (targetRowIndex !== undefined && targetRowIndex - rowIndex === 1) {
                resumingConnections.push(conn);
                suspendedConnections.splice(i, 1);
            }
        }

        // 1. Find all lanes expecting this commit
        const expectingLanes: number[] = [];
        for (let i = 0; i < lanes.length; i++) {
            if (lanes[i]?.targetHash === hash) {
                expectingLanes.push(i);
            }
        }

        const isDefaultBranchCommit = isDefaultBranchHash(hash);
        // Keep incoming coordinates unchanged; route side lanes into the pinned node.
        let myLaneIndex = isDefaultBranchCommit ? 0 : expectingLanes[0] ?? findEmptyLane();
        if (!isDefaultBranchCommit && expectingLanes.length > 0 && !lanes[expectingLanes[0]]?.isResuming) {
            // A down arrow may have kept this lane to the right at the previous boundary.
            // Reclaim the empty column before placing the node, keeping the incoming bend.
            for (let column = reserveDefaultLane ? 1 : 0; column < myLaneIndex; column++) {
                if (lanes[column] === null) {
                    myLaneIndex = column;
                    break;
                }
            }
        }
        ensureLaneExists(myLaneIndex);
        const myColor = isDefaultBranchCommit
            ? BRANCH_COLORS[0]
            : lanes[expectingLanes[0]]?.color ?? reconnectingConnections[0]?.color ?? allocateColor();
        const isMerge = parentHashes.length > 1;
        maxX = myLaneIndex;

        // 3. Draw incoming line from previous row (if not reconnecting)
        if (expectingLanes.includes(myLaneIndex) && lanes[myLaneIndex] !== null) {
            const laneInfo = lanes[myLaneIndex]!;

            lines.push({
                x1: myLaneIndex,
                y1: 0,
                x2: myLaneIndex,
                y2: 0.5,
                color: laneInfo.color,
                isMerge: false,
                isDashed: laneInfo.isDashed
            });
        }

        // 4. Draw reconnecting connections (at a target without a visible resume row)
        for (const conn of reconnectingConnections) {
            // Find the lane that was used for this connection
            let reconnectLane = lanes.findIndex(l => l?.targetHash === hash && l?.sourceHash === conn.sourceHash);
            if (reconnectLane === -1) {
                reconnectLane = findEmptyLane();
            }

            if (reconnectLane > maxX) maxX = reconnectLane;

            // Draw curved line from reconnect lane to commit
            lines.push({
                x1: reconnectLane,
                y1: 0,
                x2: myLaneIndex,
                y2: 0.5,
                color: conn.color,
                isMerge: true,
                isDashed: conn.isDashed
            });

            // Clear the lane
            lanes[reconnectLane] = null;
        }

        // 5. Draw incoming merges from other lanes
        for (const fromLane of expectingLanes) {
            if (fromLane === myLaneIndex) continue;
            const laneInfo = lanes[fromLane]!;

            if (fromLane > maxX) maxX = fromLane;

            lines.push({
                x1: fromLane,
                y1: 0,
                x2: myLaneIndex,
                y2: 0.5,
                color: laneInfo.color,
                isMerge: true,
                isDashed: laneInfo.isDashed
            });
            lanes[fromLane] = null;
        }

        // Calculate how many new lanes are needed for merge parents (fork lines)
        let neededForForks = 0;
        if (parentHashes.length > 1) {
            for (let i = 1; i < parentHashes.length; i++) {
                const parentHash = parentHashes[i];
                // Check if this parent already has a lane
                const existingLane = lanes.findIndex(l => l?.targetHash === parentHash);
                if (existingLane === -1) {
                    neededForForks++;
                }
            }
        }

        // Resume after incoming bends have released their columns.
        // Other incoming curves must not cross through an arrow stem.
        const unavailableResumeColumns = new Set<number>([myLaneIndex]);
        for (const line of lines) {
            if (line.y1 !== 0 || line.y2 !== 0.5) continue;
            for (let column = Math.min(line.x1, line.x2) + 1; column < Math.max(line.x1, line.x2); column++) {
                unavailableResumeColumns.add(column);
            }
        }

        // 4b. Handle resuming connections (one row before target) - draw arrow and allocate lane
        let reservedForForks = 0;
        for (const conn of resumingConnections) {
            // Find an empty lane, but skip myLaneIndex and lanes reserved for forks
            let resumeLane = -1;
            let skipped = 0;
            ensureLaneExists(0);
            for (let i = 0; i < lanes.length; i++) {
                // Skip current commit's lane
                if (unavailableResumeColumns.has(i) || (reserveDefaultLane && i === 0)) continue;

                if (lanes[i] === null) {
                    if (skipped < neededForForks - reservedForForks) {
                        skipped++;
                        reservedForForks++;
                        continue;
                    }
                    resumeLane = i;
                    break;
                }
            }
            if (resumeLane === -1) {
                resumeLane = findEmptyLane(unavailableResumeColumns);
            }

            if (resumeLane > maxX) maxX = resumeLane;

            // Keep the arrow stem in one column until it reaches the target row.
            arrowColumns.add(resumeLane);
            lines.push({
                x1: resumeLane,
                y1: 0.3,
                x2: resumeLane,
                y2: 1,
                color: conn.color,
                isMerge: false,
                isLongDistance: true,
                targetCommitHash: conn.sourceHash,
                arrowDirection: 'up',
                isDashed: conn.isDashed
            });

            // Occupy the lane with this connection info, mark as resuming to skip pass-through line
            lanes[resumeLane] = {
                targetHash: conn.targetHash,
                sourceRowIndex: rowIndex,
                sourceHash: conn.sourceHash,
                color: conn.color,
                isResuming: true,
                isDashed: conn.isDashed
            };
        }

        // 6. Draw pass-through lines for other active lanes
        for (let i = 0; i < lanes.length; i++) {
            const laneInfo = lanes[i];
            if (laneInfo !== null && laneInfo.targetHash !== hash && i !== myLaneIndex) {
                const distance = rowIndex - laneInfo.sourceRowIndex;
                const targetRowIndex = commitIndexMap.get(laneInfo.targetHash);

                // In filtered mode, if target not found, clear the lane instead of using fallback
                if (targetRowIndex === undefined) {
                    if (isFilteredMode) {
                        lanes[i] = null;
                        continue;
                    }
                }

                const effectiveTargetIndex = targetRowIndex ?? commits.length - 1;
                const distanceToTarget = effectiveTargetIndex - rowIndex;

                // Check if this should become a suspended connection
                const totalDistance = effectiveTargetIndex - laneInfo.sourceRowIndex;
                const shouldSuspend = !(reserveDefaultLane && i === 0)
                    && totalDistance > LONG_DISTANCE_THRESHOLD && distance >= 1 && distanceToTarget > 1;
                if (shouldSuspend) {
                    // End inside the neighboring row so another edge can reuse the boundary below.
                    arrowColumns.add(i);
                    if (i > maxX) maxX = i;
                    lines.push({
                        x1: i,
                        y1: 0,
                        x2: i,
                        y2: 0.7,
                        color: laneInfo.color,
                        isMerge: false,
                        isLongDistance: true,
                        targetCommitHash: laneInfo.targetHash,
                        arrowDirection: 'down',
                        isDashed: laneInfo.isDashed
                    });

                    // Suspend this connection and free the lane
                    suspendedConnections.push({
                        targetHash: laneInfo.targetHash,
                        sourceRowIndex: laneInfo.sourceRowIndex,
                        sourceHash: laneInfo.sourceHash,
                        originalLane: i,
                        color: laneInfo.color,
                        isDashed: laneInfo.isDashed
                    });
                    lanes[i] = null;
                } else {
                    // Normal pass-through
                    if (i > maxX) maxX = i;

                    // If this lane was just resumed (isResuming), skip drawing here
                    // because step 4b already drew the arrow stem
                    if (!laneInfo.isResuming) {
                        lines.push({
                            x1: i,
                            y1: 0,
                            x2: i,
                            y2: 1,
                            color: laneInfo.color,
                            isMerge: false,
                            isDashed: laneInfo.isDashed
                        });
                    }
                }
            }
        }

        // 7. Update my lane for parents and draw outgoing lines
        if (parentHashes.length === 0) {
            // In filtered mode, check if we have filteredAncestors to draw dashed lines
            if (commit.filteredAncestors && commit.filteredAncestors.length > 0) {
                // Draw dashed line to the first filtered ancestor
                const ancestorHash = commit.filteredAncestors[0];
                const ancestorRowIndex = commitIndexMap.get(ancestorHash);

                if (ancestorRowIndex !== undefined) {
                    lanes[myLaneIndex] = {
                        targetHash: ancestorHash,
                        sourceRowIndex: rowIndex,
                        sourceHash: hash,
                        color: myColor,
                        isDashed: true
                    };

                    // Always draw as dashed line for filtered ancestor connection
                    lines.push({
                        x1: myLaneIndex,
                        y1: 0.5,
                        x2: myLaneIndex,
                        y2: 1,
                        color: myColor,
                        isMerge: false,
                        isDashed: true
                    });
                } else {
                    lanes[myLaneIndex] = null;
                }
            } else {
                lanes[myLaneIndex] = null;
            }
        } else {
            parentHashes.forEach((parentHash, i) => {
                const parentExists = commitIndexMap.has(parentHash);

                // Skip if list is finalized and parent is not in the list
                if (!hasMore && !parentExists) {
                    if (i === 0) {
                        lanes[myLaneIndex] = null;
                    }
                    return;
                }

                if (i === 0) {
                    lanes[myLaneIndex] = {
                        targetHash: parentHash,
                        sourceRowIndex: rowIndex,
                        sourceHash: hash,
                        color: myColor
                    };

                    lines.push({
                        x1: myLaneIndex,
                        y1: 0.5,
                        x2: myLaneIndex,
                        y2: 1,
                        color: myColor,
                        isMerge: false
                    });
                } else {
                    // Find existing lane for this parent, but exclude resuming lanes
                    let parentLaneIndex = lanes.findIndex(l => l?.targetHash === parentHash && !l?.isResuming);
                    if (parentLaneIndex === -1) {
                        parentLaneIndex = isDefaultBranchHash(parentHash) && !lanes[0] ? 0 : findEmptyLane();
                        ensureLaneExists(parentLaneIndex);
                        lanes[parentLaneIndex] = {
                            targetHash: parentHash,
                            sourceRowIndex: rowIndex,
                            sourceHash: hash,
                            color: reserveDefaultLane && parentLaneIndex === 0 ? BRANCH_COLORS[0] : allocateColor()
                        };
                    }

                    if (parentLaneIndex > maxX) maxX = parentLaneIndex;

                    const parentColor = lanes[parentLaneIndex]?.color || BRANCH_COLORS[parentLaneIndex % BRANCH_COLORS.length];

                    lines.push({
                        x1: myLaneIndex,
                        y1: 0.5,
                        x2: parentLaneIndex,
                        y2: 1,
                        color: parentColor,
                        isMerge: true
                    });
                }
            });
        }

        // 8. Make room for main only when it appears, bending existing lines at this boundary.
        let pinnedLaneIndex = reserveDefaultLane ? 0 : -1;
        const nextHash = commits[rowIndex + 1]?.hash;
        if (!reserveDefaultLane && isDefaultBranchHash(nextHash)) {
            reserveDefaultLane = true;
            pinnedLaneIndex = lanes.findIndex(lane => lane?.targetHash === nextHash);
            if (pinnedLaneIndex > 0 && (arrowColumns.has(pinnedLaneIndex) || arrowColumns.has(0))) {
                pinnedLaneIndex = -1;
            }
        }
        const compactedLanes: (LaneInfo | null)[] = reserveDefaultLane
            ? [lanes[pinnedLaneIndex] ?? null]
            : [];
        const laneMapping = new Map<number, number>();

        if (pinnedLaneIndex >= 0 && lanes[pinnedLaneIndex]) laneMapping.set(pinnedLaneIndex, 0);

        // Only upward arrows continue across this boundary; downward arrows have ended.
        const continuingArrowColumns = new Set([...arrowColumns].filter(column => lanes[column] !== null));
        for (const column of continuingArrowColumns) {
            while (compactedLanes.length <= column) compactedLanes.push(null);
            compactedLanes[column] = lanes[column];
            if (lanes[column]) laneMapping.set(column, column);
        }
        let nextColumn = reserveDefaultLane ? 1 : 0;
        for (let i = 0; i < lanes.length; i++) {
            if (i !== pinnedLaneIndex && !continuingArrowColumns.has(i) && lanes[i] !== null) {
                // Do not pull an edge left behind a terminating arrow just to compact it.
                // A necessary rightward move (for example, making room for main) can reuse its slot.
                while (continuingArrowColumns.has(nextColumn) || compactedLanes[nextColumn]
                    || (nextColumn < i && arrowColumns.has(nextColumn))) nextColumn++;
                while (compactedLanes.length <= nextColumn) compactedLanes.push(null);
                compactedLanes[nextColumn] = lanes[i];
                laneMapping.set(i, nextColumn++);
            }
        }
        while (compactedLanes.length > (reserveDefaultLane ? 1 : 0) && compactedLanes.at(-1) === null) {
            compactedLanes.pop();
        }

        // Apply mapping to lines that extend to the next row (y2 === 1)
        lines.forEach(line => {
            if (line.y2 === 1 && line.arrowDirection !== 'down') {
                const newX2 = laneMapping.get(line.x2);
                if (newX2 !== undefined) {
                    // Approach a released arrow column in the lower half, below its head.
                    if (newX2 !== line.x1 && line.y1 === 0 && arrowColumns.has(newX2)
                        && !continuingArrowColumns.has(newX2)) {
                        lines.push({ ...line, x2: line.x1, y2: 0.5 });
                        line.y1 = 0.5;
                    }
                    line.x2 = newX2;
                }
            }
            // Update maxX to ensure SVG covers all drawn lines
            if (line.x1 > maxX) maxX = line.x1;
            if (line.x2 > maxX) maxX = line.x2;
        });

        // Update lanes for next iteration
        lanes.splice(0, lanes.length, ...compactedLanes);

        graph.set(hash, {
            column: myLaneIndex,
            color: myColor,
            lines,
            isMerge,
            maxX
        });
    }

    return graph;
}
