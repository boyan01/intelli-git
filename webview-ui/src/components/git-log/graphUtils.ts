import type { LogCommit } from '../../../../shared/messages';

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
}

export interface GraphNode {
    column: number;
    color: string;
    lines: GraphLine[];
    isMerge: boolean;
    maxX: number;
}

interface LaneInfo {
    targetHash: string;
    sourceRowIndex: number;
    sourceHash: string;
    color: string;
    isResuming?: boolean;
}

interface SuspendedConnection {
    targetHash: string;
    sourceRowIndex: number;
    sourceHash: string;
    originalLane: number;
    color: string;
}

export function computeGraph(commits: LogCommit[]): Map<string, GraphNode> {
    const graph = new Map<string, GraphNode>();
    const lanes: (LaneInfo | null)[] = [];
    const commitIndexMap = new Map<string, number>();

    // Suspended long-distance connections that freed their lane
    const suspendedConnections: SuspendedConnection[] = [];

    commits.forEach((c, i) => commitIndexMap.set(c.hash, i));

    for (let rowIndex = 0; rowIndex < commits.length; rowIndex++) {
        const commit = commits[rowIndex];
        const { hash, parentHashes } = commit;
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

        // Check if any suspended connections should resume 2 rows before target
        const resumingConnections: SuspendedConnection[] = [];
        for (let i = suspendedConnections.length - 1; i >= 0; i--) {
            const conn = suspendedConnections[i];
            const targetRowIndex = commitIndexMap.get(conn.targetHash);
            if (targetRowIndex !== undefined && targetRowIndex - rowIndex === 2) {
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

        // 2. Determine my column
        let myLaneIndex: number;
        if (expectingLanes.length > 0) {
            myLaneIndex = expectingLanes[0];
        } else if (reconnectingConnections.length > 0) {
            // Reconnecting from a suspended connection - find an empty lane
            const emptyIdx = lanes.findIndex(l => l === null);
            if (emptyIdx === -1) {
                myLaneIndex = lanes.length;
                lanes.push(null);
            } else {
                myLaneIndex = emptyIdx;
            }
        } else {
            const emptyIdx = lanes.findIndex(l => l === null);
            if (emptyIdx === -1) {
                myLaneIndex = lanes.length;
                lanes.push(null);
            } else {
                myLaneIndex = emptyIdx;
            }
        }

        const myColor = BRANCH_COLORS[myLaneIndex % BRANCH_COLORS.length];
        const isMerge = parentHashes.length > 1;
        maxX = myLaneIndex;

        // 3. Draw incoming line from previous row (if not reconnecting)
        if (expectingLanes.length > 0) {
            const laneInfo = lanes[myLaneIndex]!;
            const distance = rowIndex - laneInfo.sourceRowIndex;
            const isLong = distance > LONG_DISTANCE_THRESHOLD;

            lines.push({
                x1: myLaneIndex,
                y1: 0,
                x2: myLaneIndex,
                y2: 0.5,
                color: laneInfo.color,
                isMerge: false,
                isLongDistance: isLong,
                targetCommitHash: isLong ? laneInfo.sourceHash : undefined,
                arrowDirection: isLong ? 'up' : undefined
            });
        }

        // 4. Draw reconnecting connections (from lanes that resumed 2 rows ago)
        for (const conn of reconnectingConnections) {
            // Find the lane that was used for this connection
            let reconnectLane = lanes.findIndex(l => l?.targetHash === hash && l?.sourceHash === conn.sourceHash);
            if (reconnectLane === -1) {
                // Fallback: find any empty lane
                reconnectLane = lanes.findIndex(l => l === null);
                if (reconnectLane === -1) {
                    reconnectLane = lanes.length;
                    lanes.push(null);
                }
            }

            if (reconnectLane > maxX) maxX = reconnectLane;

            // Draw curved line from reconnect lane to commit
            lines.push({
                x1: reconnectLane,
                y1: 0,
                x2: myLaneIndex,
                y2: 0.5,
                color: conn.color,
                isMerge: true
            });

            // Clear the lane
            lanes[reconnectLane] = null;
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

        // 4b. Handle resuming connections (2 rows before target) - draw arrow and allocate lane
        let reservedForForks = 0;
        for (const conn of resumingConnections) {
            // Find an empty lane, but skip myLaneIndex and lanes reserved for forks
            let resumeLane = -1;
            let skipped = 0;
            for (let i = 0; i < lanes.length; i++) {
                // Skip current commit's lane
                if (i === myLaneIndex) continue;

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
                resumeLane = lanes.length;
                lanes.push(null);
            }

            if (resumeLane > maxX) maxX = resumeLane;

            // Draw only the arrow indicator at center (y=0.5), line continues to y=1
            lines.push({
                x1: resumeLane,
                y1: 0.5,
                x2: resumeLane,
                y2: 1,
                color: conn.color,
                isMerge: false,
                isLongDistance: true,
                targetCommitHash: conn.sourceHash,
                arrowDirection: 'up'
            });

            // Occupy the lane with this connection info, mark as resuming to skip pass-through line
            lanes[resumeLane] = {
                targetHash: conn.targetHash,
                sourceRowIndex: rowIndex,
                sourceHash: conn.sourceHash,
                color: conn.color,
                isResuming: true
            };
        }

        // 5. Draw incoming merges from other lanes
        for (let i = 1; i < expectingLanes.length; i++) {
            const fromLane = expectingLanes[i];
            const laneInfo = lanes[fromLane]!;
            const distance = rowIndex - laneInfo.sourceRowIndex;
            const isLong = distance > LONG_DISTANCE_THRESHOLD;

            if (fromLane > maxX) maxX = fromLane;

            lines.push({
                x1: fromLane,
                y1: 0,
                x2: myLaneIndex,
                y2: 0.5,
                color: laneInfo.color,
                isMerge: true,
                isLongDistance: isLong,
                targetCommitHash: isLong ? laneInfo.sourceHash : undefined,
                arrowDirection: isLong ? 'up' : undefined
            });
            lanes[fromLane] = null;
        }

        // 6. Draw pass-through lines for other active lanes
        for (let i = 0; i < lanes.length; i++) {
            const laneInfo = lanes[i];
            if (laneInfo !== null && laneInfo.targetHash !== hash && i !== myLaneIndex) {
                const distance = rowIndex - laneInfo.sourceRowIndex;
                const targetRowIndex = commitIndexMap.get(laneInfo.targetHash);
                // If target not found, use max loaded index as fallback
                const effectiveTargetIndex = targetRowIndex ?? commits.length - 1;
                const distanceToTarget = effectiveTargetIndex - rowIndex;

                // Check if this should become a suspended connection
                const totalDistance = effectiveTargetIndex - laneInfo.sourceRowIndex;
                const shouldSuspend = totalDistance > LONG_DISTANCE_THRESHOLD && distance >= 2 && distanceToTarget > 2;
                if (shouldSuspend) {
                    // Add arrow line pointing down before suspending
                    if (i > maxX) maxX = i;
                    lines.push({
                        x1: i,
                        y1: 0,
                        x2: i,
                        y2: 0.5,
                        color: laneInfo.color,
                        isMerge: false,
                        isLongDistance: true,
                        targetCommitHash: laneInfo.targetHash,
                        arrowDirection: 'down'
                    });

                    // Suspend this connection and free the lane
                    suspendedConnections.push({
                        targetHash: laneInfo.targetHash,
                        sourceRowIndex: laneInfo.sourceRowIndex,
                        sourceHash: laneInfo.sourceHash,
                        originalLane: i,
                        color: laneInfo.color
                    });
                    lanes[i] = null;
                } else {
                    // Normal pass-through
                    if (i > maxX) maxX = i;

                    // If this lane was just resumed (isResuming), skip drawing here
                    // because step 4b already drew the line from y=0.5 to y=1
                    if (laneInfo.isResuming) {
                        // Clear the flag and skip drawing
                        lanes[i] = { ...laneInfo, isResuming: false };
                    } else {
                        lines.push({
                            x1: i,
                            y1: 0,
                            x2: i,
                            y2: 1,
                            color: laneInfo.color,
                            isMerge: false
                        });
                    }
                }
            }
        }

        // 7. Update my lane for parents and draw outgoing lines
        if (parentHashes.length === 0) {
            lanes[myLaneIndex] = null;
        } else {
            parentHashes.forEach((parentHash, i) => {
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
                        const emptyIdx = lanes.findIndex(l => l === null);
                        if (emptyIdx === -1) {
                            parentLaneIndex = lanes.length;
                            lanes.push({
                                targetHash: parentHash,
                                sourceRowIndex: rowIndex,
                                sourceHash: hash,
                                color: BRANCH_COLORS[parentLaneIndex % BRANCH_COLORS.length]
                            });
                        } else {
                            parentLaneIndex = emptyIdx;
                            lanes[parentLaneIndex] = {
                                targetHash: parentHash,
                                sourceRowIndex: rowIndex,
                                sourceHash: hash,
                                color: BRANCH_COLORS[parentLaneIndex % BRANCH_COLORS.length]
                            };
                        }
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
