import React from 'react';
import type { GraphNode, GraphLine } from './graphUtils';

interface GraphColumnProps {
    node: GraphNode;
    rowHeight: number;
    graphWidth: number;
}

export const CELL_WIDTH = 16;


export const GraphColumn: React.FC<GraphColumnProps> = ({ node, rowHeight, graphWidth }) => {
    const DOT_RADIUS = 5;
    const STROKE_WIDTH = 3;

    const getPath = (line: GraphLine) => {
        const x1 = line.x1 * CELL_WIDTH + CELL_WIDTH / 2;
        const y1 = line.y1 * rowHeight;
        const x2 = line.x2 * CELL_WIDTH + CELL_WIDTH / 2;
        const y2 = line.y2 * rowHeight;

        if (line.x1 === line.x2) {
            return `M ${x1} ${y1} L ${x2} ${y2}`;
        }

        // Use 1/2 offset for control points for a smoother S-curve
        const dy = y2 - y1;
        return `M ${x1} ${y1} C ${x1} ${y1 + dy / 2}, ${x2} ${y2 - dy / 2}, ${x2} ${y2}`;
    };

    return (
        <svg width={graphWidth} height={rowHeight} style={{ overflow: 'visible', pointerEvents: 'none' }}>
            {node.lines.map((line, i) => (
                <path
                    key={i}
                    d={getPath(line)}
                    stroke={line.color}
                    strokeWidth={2}
                    fill="none"
                    strokeLinecap="round"
                />
            ))}
            <circle
                cx={node.column * CELL_WIDTH + CELL_WIDTH / 2}
                cy={rowHeight / 2}
                r={DOT_RADIUS}
                fill={node.color}
                stroke="var(--vscode-editor-background)"
                strokeWidth={STROKE_WIDTH}
            />
        </svg>
    );
};

