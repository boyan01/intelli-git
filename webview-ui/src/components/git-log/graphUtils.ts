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

export interface GraphLine {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    color: string;
    isMerge: boolean;
}

export interface GraphNode {
    column: number;
    color: string;
    lines: GraphLine[];
    isMerge: boolean;
}

export function computeGraph(commits: LogCommit[]): Map<string, GraphNode> {
    const graph = new Map<string, GraphNode>();
    const lanes: (string | null)[] = [];

    for (const commit of commits) {
        const { hash, parentHashes } = commit;
        const lines: GraphLine[] = [];

        // 1. Find all lanes expecting this commit
        const expectingLanes: number[] = [];
        for (let i = 0; i < lanes.length; i++) {
            if (lanes[i] === hash) {
                expectingLanes.push(i);
            }
        }

        // 2. Determine my column
        let myLaneIndex: number;
        if (expectingLanes.length > 0) {
            myLaneIndex = expectingLanes[0];
        } else {
            // New branch tip or root
            myLaneIndex = lanes.indexOf(null);
            if (myLaneIndex === -1) {
                myLaneIndex = lanes.length;
                lanes.push(hash); // Temporarily occupy to reserve slot
            } else {
                lanes[myLaneIndex] = hash;
            }
        }

        const myColor = BRANCH_COLORS[myLaneIndex % BRANCH_COLORS.length];
        const isMerge = parentHashes.length > 1;

        // 3. Draw incoming line from previous row to the node center
        if (expectingLanes.length > 0) {
            lines.push({
                x1: myLaneIndex,
                y1: 0,
                x2: myLaneIndex,
                y2: 0.5,
                color: myColor,
                isMerge: false
            });
        }

        // 4. Draw incoming merges (merges into this commit from other lanes)
        for (let i = 1; i < expectingLanes.length; i++) {
            const fromLane = expectingLanes[i];
            const fromColor = BRANCH_COLORS[fromLane % BRANCH_COLORS.length];
            lines.push({
                x1: fromLane,
                y1: 0,
                x2: myLaneIndex,
                y2: 0.5,
                color: fromColor,
                isMerge: true
            });
            lanes[fromLane] = null;
        }

        // 4. Draw pass-through lines for other active lanes
        for (let i = 0; i < lanes.length; i++) {
            if (lanes[i] !== null && lanes[i] !== hash && i !== myLaneIndex) {
                // Optimization: Don't draw if lane occupied by me (handled later) 
                // (Already checked i !== myLaneIndex)
                // Lane `i` is waiting for `lanes[i]`. Just pass through.
                lines.push({
                    x1: i,
                    y1: 0,
                    x2: i,
                    y2: 1,
                    color: BRANCH_COLORS[i % BRANCH_COLORS.length],
                    isMerge: false
                });
            }
        }

        // 5. Update my lane for parents and draw outgoing lines
        if (parentHashes.length === 0) {
            lanes[myLaneIndex] = null; // End of history
        } else {
            parentHashes.forEach((parentHash, i) => {
                if (i === 0) {
                    // Primary parent keeps my lane
                    lanes[myLaneIndex] = parentHash;
                    lines.push({
                        x1: myLaneIndex,
                        y1: 0.5,
                        x2: myLaneIndex,
                        y2: 1,
                        color: myColor,
                        isMerge: false
                    });
                } else {
                    // Merge parent (outgoing to another branch)
                    // Check if parent already expected
                    let parentLaneIndex = lanes.indexOf(parentHash);
                    if (parentLaneIndex === -1) {
                        // Allocate new lane for parent
                        parentLaneIndex = lanes.indexOf(null);
                        if (parentLaneIndex === -1) {
                            parentLaneIndex = lanes.length;
                            lanes.push(parentHash);
                        } else {
                            lanes[parentLaneIndex] = parentHash;
                        }
                    }

                    const parentColor = BRANCH_COLORS[parentLaneIndex % BRANCH_COLORS.length];
                    lines.push({
                        x1: myLaneIndex,
                        y1: 0.5,
                        x2: parentLaneIndex,
                        y2: 1,
                        color: parentColor, // Use target color to indicate where it goes
                        isMerge: true
                    });
                }
            });
        }

        graph.set(hash, {
            column: myLaneIndex,
            color: myColor,
            lines,
            isMerge
        });
    }

    return graph;
}
