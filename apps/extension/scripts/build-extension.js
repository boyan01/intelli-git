const path = require('path');
const { build, context } = require('esbuild');

const repoRoot = path.resolve(__dirname, '../../..');
const extensionRoot = path.resolve(__dirname, '..');
const isWatch = process.argv.includes('--watch');

const sharedAlias = path.resolve(repoRoot, 'packages/shared');

async function createBuildOptions() {
    return {
        absWorkingDir: extensionRoot,
        entryPoints: [path.resolve(extensionRoot, 'src/extension.ts')],
        outfile: path.resolve(extensionRoot, 'out/extension.js'),
        bundle: true,
        format: 'cjs',
        platform: 'node',
        target: 'node20',
        sourcemap: false,
        minify: false,
        tsconfig: path.resolve(extensionRoot, 'tsconfig.json'),
        alias: {
            '@shared': sharedAlias,
        },
        external: ['vscode'],
    };
}

async function run() {
    const buildOptions = await createBuildOptions();

    if (isWatch) {
        const ctx = await context(buildOptions);
        await ctx.watch();
        console.log('Watching extension build with esbuild...');
        return;
    }

    await build(buildOptions);
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
