const fs = require('fs');
const path = require('path');

const sourceDir = path.join(__dirname, '../../..', 'packages/shared/l10n');
const targetDir = path.join(__dirname, '..', 'l10n');

function ensureDirectory(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function clearDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) {
        return;
    }

    for (const entry of fs.readdirSync(dirPath)) {
        fs.rmSync(path.join(dirPath, entry), { recursive: true, force: true });
    }
}

function syncL10n() {
    if (!fs.existsSync(sourceDir)) {
        throw new Error(`L10n source directory not found: ${sourceDir}`);
    }

    ensureDirectory(targetDir);
    clearDirectory(targetDir);

    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
        if (!entry.isFile()) {
            continue;
        }

        const sourcePath = path.join(sourceDir, entry.name);
        const targetPath = path.join(targetDir, entry.name);
        fs.copyFileSync(sourcePath, targetPath);
    }
}

try {
    syncL10n();
    console.log(`Synced l10n files to ${targetDir}`);
} catch (error) {
    console.error('Failed to sync l10n files:', error);
    process.exitCode = 1;
}
