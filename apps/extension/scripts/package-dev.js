const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');

const packageJsonPath = path.join(__dirname, '../package.json');
const packageRoot = path.resolve(__dirname, '..');
const originalPackageJsonOnDisk = fs.readFileSync(packageJsonPath, 'utf8');
const packageData = JSON.parse(originalPackageJsonOnDisk);
const baseVersion = packageData.version.replace(/(?:-dev\.\d+)+$/, '');
const originalPackageJson =
    baseVersion === packageData.version
        ? originalPackageJsonOnDisk
        : `${JSON.stringify({ ...packageData, version: baseVersion }, null, 2)}\n`;
const baseContentUrl =
    process.env.VSCE_BASE_CONTENT_URL || 'https://raw.githubusercontent.com/boyan01/intelli-git/main';
const baseImagesUrl = process.env.VSCE_BASE_IMAGES_URL || 'https://raw.githubusercontent.com/boyan01/intelli-git/main';
const shouldInstall = process.argv.includes('--install');
process.env.INTELLI_GIT_BUILD_CHANNEL = 'dev';
process.env.MODE = process.env.MODE || 'dev';
let vscodeCli = process.env.VSCODE_CLI;
if (!vscodeCli) {
    // Dynamically detect the CLI path when running inside Antigravity IDE's integrated terminal
    if (process.env.ANTIGRAVITY_EDITOR_APP_ROOT) {
        vscodeCli = path.join(process.env.ANTIGRAVITY_EDITOR_APP_ROOT, 'bin/antigravity-ide');
    } else {
        vscodeCli = 'code';
    }
}

function formatDatePart(value) {
    return String(value).padStart(2, '0');
}

function getBuildTimestamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = formatDatePart(now.getMonth() + 1);
    const day = formatDatePart(now.getDate());
    const hour = formatDatePart(now.getHours());
    const minute = formatDatePart(now.getMinutes());

    return `${year}${month}${day}${hour}${minute}`;
}

try {
    // 1. Get current build timestamp
    const buildTimestamp = getBuildTimestamp();
    console.log(`Current Build Timestamp: ${buildTimestamp}`);

    // 2. Modify version to include timestamp (SemVer compliant)
    // E.g. 0.0.1 -> 0.0.1-dev.202603301430
    const newVersion = `${baseVersion}-dev.${buildTimestamp}`;

    packageData.version = newVersion;
    console.log(`Temporary Version: ${newVersion}`);

    fs.writeFileSync(packageJsonPath, JSON.stringify(packageData, null, 2));

    // 3. Run packaging
    console.log('Running vsce package...');

    // Define output path to root workspace's out directory
    const outDir = path.join(__dirname, '../../../out');
    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }
    const outFilePath = path.join(outDir, `${packageData.name}-${newVersion}.vsix`);
    const outFileArg = path.relative(packageRoot, outFilePath);

    execSync(
        `vsce package --baseContentUrl "${baseContentUrl}" --baseImagesUrl "${baseImagesUrl}" -o "${outFileArg}"`,
        { stdio: ['ignore', process.stdout, process.stderr] }
    );

    console.log(`\nSuccessfully packaged version to: ${outFilePath}`);
    execFileSync(process.execPath, [path.join(__dirname, 'verify-vsix.js'), outFilePath, '--version', newVersion], {
        stdio: ['ignore', process.stdout, process.stderr],
    });

    if (shouldInstall) {
        console.log(`Installing extension with ${vscodeCli}...`);
        execFileSync(vscodeCli, ['--install-extension', outFilePath, '--force'], {
            stdio: ['ignore', process.stdout, process.stderr],
        });
        console.log('Successfully installed extension.');
    }
} catch (error) {
    console.error('Packaging failed:', error);
    process.exitCode = 1;
} finally {
    // 4. Restore original package.json
    console.log('Restoring package.json...');
    fs.writeFileSync(packageJsonPath, originalPackageJson);
}
