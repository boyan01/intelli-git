const path = require('path');
const fs = require('fs/promises');
const { build, context } = require('esbuild');

const repoRoot = path.resolve(__dirname, '../../..');
const extensionRoot = path.resolve(__dirname, '..');
const isWatch = process.argv.includes('--watch');

const sharedAlias = path.resolve(repoRoot, 'packages/shared');
const sourceRoot = path.resolve(extensionRoot, 'src');

function createMacroReplacePlugin(finalBuildTime) {
  const buildTimeLiteral = JSON.stringify(String(finalBuildTime));
  const expiredExpr = `(Date.now() - ${finalBuildTime} > 30 * 24 * 60 * 60 * 1000)`;

  return {
    name: 'macro-replace',
    setup(pluginBuild) {
      pluginBuild.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async (args) => {
        if (!args.path.startsWith(sourceRoot)) {
          return undefined;
        }

        const contents = await fs.readFile(args.path, 'utf8');
        const replaced = contents
          .replaceAll('__BUILD_TIME__', buildTimeLiteral)
          .replaceAll('__IS_EXPIRED__', expiredExpr);

        return {
          contents: replaced,
          loader: args.path.endsWith('.tsx')
            ? 'tsx'
            : args.path.endsWith('.ts')
              ? 'ts'
              : args.path.endsWith('.jsx')
                ? 'jsx'
                : 'js',
        };
      });
    },
  };
}

async function createBuildOptions() {
  const { loadEnv } = await import('vite');
  const mode = process.env.MODE || process.env.NODE_ENV || 'production';
  const env = loadEnv(mode, repoRoot, '');
  const daysAgo = parseFloat(env.DEBUG_BUILD_DAYS_AGO || '0');
  const finalBuildTime = Date.now() - (daysAgo * 24 * 60 * 60 * 1000);

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
    plugins: [createMacroReplacePlugin(finalBuildTime)],
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
