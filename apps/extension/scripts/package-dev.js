const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const packageJsonPath = path.join(__dirname, '../package.json');
const originalPackageJson = fs.readFileSync(packageJsonPath, 'utf8');
const packageData = JSON.parse(originalPackageJson);

try {
    // 1. Get current git short hash
    const gitHash = execSync('git rev-parse --short HEAD').toString().trim();
    console.log(`Current Git Commit: ${gitHash}`);

    // 2. Modify version to include hash (SemVer compliant)
    // E.g. 0.0.1 -> 0.0.1-alpha.abcdef
    const originalVersion = packageData.version;
    const newVersion = `${originalVersion}-dev.${gitHash}`;

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

    execSync(`vsce package --allow-missing-repository --skip-license -o "${outFilePath}"`, { stdio: ['ignore', process.stdout, process.stderr] });

    console.log(`\nSuccessfully packaged version to: ${outFilePath}`);

} catch (error) {
    console.error('Packaging failed:', error);
    process.exitCode = 1;
} finally {
    // 4. Restore original package.json
    console.log('Restoring package.json...');
    fs.writeFileSync(packageJsonPath, originalPackageJson);
}
