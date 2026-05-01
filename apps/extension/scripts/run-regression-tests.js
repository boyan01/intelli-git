const { mkdtempSync, readdirSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const esbuild = require('esbuild');

const extensionRoot = resolve(__dirname, '..');
const repoRoot = resolve(extensionRoot, '../..');
const tempDir = mkdtempSync(join(tmpdir(), 'intelli-git-regression-'));
const bundlePath = join(tempDir, 'regression-tests.cjs');
const vscodeMockPath = resolve(extensionRoot, 'src/testSupport/vscodeMock.ts');

function findRegressionTests(dir) {
    const entries = readdirSync(dir, { withFileTypes: true });
    return entries.flatMap(entry => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            return findRegressionTests(path);
        }
        return entry.isFile() && entry.name.endsWith('.regression.test.ts') ? [path] : [];
    });
}

const vscodeMockPlugin = {
    name: 'vscode-mock',
    setup(build) {
        build.onResolve({ filter: /^vscode$/ }, () => ({ path: vscodeMockPath }));
    }
};

async function main() {
    try {
        const testImports = findRegressionTests(resolve(extensionRoot, 'src'))
            .sort()
            .map(path => `import ${JSON.stringify(path)};`)
            .join('\n');

        await esbuild.build({
            absWorkingDir: repoRoot,
            bundle: true,
            external: [],
            format: 'cjs',
            stdin: {
                contents: testImports,
                loader: 'ts',
                resolveDir: repoRoot,
                sourcefile: 'regression-entry.ts'
            },
            logLevel: 'info',
            outfile: bundlePath,
            platform: 'node',
            plugins: [vscodeMockPlugin],
            sourcemap: 'inline',
            target: 'node20',
            tsconfig: resolve(extensionRoot, 'tsconfig.json')
        });

        const result = spawnSync(process.execPath, ['--test', bundlePath], {
            cwd: repoRoot,
            stdio: 'inherit'
        });

        if (result.error) {
            throw result.error;
        }

        process.exitCode = result.status ?? 1;
    } finally {
        rmSync(tempDir, { force: true, recursive: true });
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
