import React from 'react';
import type { GraphNode, GraphLine } from './graphUtils';

interface GraphColumnProps {
    node: GraphNode;
    rowHeight: number;
    graphWidth: number;
    onJumpToCommit?: (hash: string) => void;
}

export const CELL_WIDTH = 16;


export const GraphColumn: React.FC<GraphColumnProps> = ({ node, rowHeight, graphWidth, onJumpToCommit }) => {
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

        const dy = y2 - y1;
        return `M ${x1} ${y1} C ${x1} ${y1 + dy / 2}, ${x2} ${y2 - dy / 2}, ${x2} ${y2}`;
    };

    const renderArrow = (line: GraphLine, index: number) => {
        if (!line.isLongDistance || !line.targetCommitHash) return null;

        const isDown = line.arrowDirection === 'down';

        // Arrow at the end of line
        const x = (isDown ? line.x2 : line.x1) * CELL_WIDTH + CELL_WIDTH / 2;
        const arrowY = (isDown ? line.y2 : line.y1) * rowHeight;

        // Triangle arrow - filled for better visibility
        const arrowSize = 5;
        const arrowPath = isDown
            ? `M ${x} ${arrowY} L ${x - arrowSize} ${arrowY - arrowSize * 1.5} L ${x + arrowSize} ${arrowY - arrowSize * 1.5} Z`
            : `M ${x} ${arrowY} L ${x - arrowSize} ${arrowY + arrowSize * 1.5} L ${x + arrowSize} ${arrowY + arrowSize * 1.5} Z`;

        return (
            <g
                key={`arrow-${index}`}
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                    e.stopPropagation();
                    onJumpToCommit?.(line.targetCommitHash!);
                }}
            >
                {/* Larger hit area */}
                <rect
                    x={x - 10}
                    y={isDown ? arrowY - 15 : arrowY}
                    width={20}
                    height={15}
                    fill="transparent"
                />
                {/* Filled triangle arrow */}
                <path
                    d={arrowPath}
                    fill={line.color}
                    stroke={line.color}
                    strokeWidth={1}
                    strokeLinejoin="round"
                />
            </g>
        );
    };

    return (
        <svg width={graphWidth} height={rowHeight} style={{ overflow: 'visible', pointerEvents: 'auto' }}>
            {node.lines.map((line, i) => (
                <React.Fragment key={i}>
                    <path
                        d={getPath(line)}
                        stroke={line.color}
                        strokeWidth={2}
                        fill="none"
                        strokeLinecap="round"
                    />
                    {renderArrow(line, i)}
                </React.Fragment>
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
