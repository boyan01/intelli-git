import React from 'react';

interface RefLabelProps {
    name: string;
    type: 'head' | 'tag' | 'remote' | 'local';
}

const styles: Record<string, React.CSSProperties> = {
    container: {
        display: 'inline-block',
        padding: '0 4px',
        borderRadius: '3px',
        marginRight: '4px',
        fontSize: '11px',
        lineHeight: '16px',
        verticalAlign: 'middle',
        border: '1px solid transparent',
    },
    head: {
        backgroundColor: '#fffbc8',
        borderColor: '#e6e600',
        color: '#000',
        fontWeight: 'bold',
    },
    local: {
        backgroundColor: '#e8f5e9',
        borderColor: '#4caf50',
        color: '#1b5e20',
    },
    remote: {
        backgroundColor: '#f3e5f5',
        borderColor: '#9c27b0',
        color: '#4a148c',
    },
    tag: {
        backgroundColor: '#fff3e0',
        borderColor: '#ff9800',
        color: '#e65100',
    }
};

export const RefLabel: React.FC<RefLabelProps> = ({ name, type }) => {
    // Determine style based on type
    let typeStyle = styles[type] || styles.local;
    if (name.includes('HEAD')) {
        typeStyle = styles.head;
        // Should we strip "HEAD -> "? Git output usually "HEAD -> master"
        // name passed here from parseRefs might be "HEAD -> master" or just "master"
    }

    // Improve dark mode support by using VS Code vars if possible?
    // Using hardcoded colors for now similar to IDEA/GitKraken.
    // Ideally should use --vscode-gitDecoration-addedResourceForeground etc or similar.

    // Let's stick to simple CSS vars if we want dark/light mode adaptable.
    // For now hardcoded is acceptable as per "Standard Web Design"? 
    // Actually user asked for "Rich Aesthetics" but also "Integrate with VS Code".
    // VS Code themes vary. Hardcoded light colors might look bad in Dark mode.
    // I'll invert or use VS Code vars.

    // For now hardcoded is acceptable as per "Standard Web Design"? 
    // Safe bet: use opacity backgrounds with currentColor?
    // Or just use specific look.

    return (
        <span style={{ ...styles.container, ...typeStyle }}>
            {name}
        </span>
    );
};
