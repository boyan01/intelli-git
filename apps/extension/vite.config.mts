import { defineConfig, loadEnv } from 'vite';
import path from 'path';
import replace from '@rollup/plugin-replace';

export default defineConfig(({ mode }) => {
  const repoRoot = path.resolve(__dirname, '../..');
  const env = loadEnv(mode, repoRoot, '');
  const daysAgo = parseFloat(env.DEBUG_BUILD_DAYS_AGO || '0');
  const finalBuildTime = Date.now() - (daysAgo * 24 * 60 * 60 * 1000);

  return {
    root: __dirname,
    envDir: repoRoot,
    resolve: {
      alias: {
        '@shared': path.resolve(__dirname, '../../packages/shared'),
      },
    },
    define: {
      __BUILD_TIME__: JSON.stringify(finalBuildTime),
    },
    plugins: [
      replace({
        __IS_EXPIRED__: `(Date.now() - ${finalBuildTime} > 30 * 24 * 60 * 60 * 1000)`,
        preventAssignment: true,
      }),
    ],
    build: {
      lib: {
        entry: path.resolve(__dirname, 'src/extension.ts'),
        formats: ['cjs'],
        fileName: 'extension'
      },
      outDir: 'out',
      emptyOutDir: false,
      minify: false,
      rollupOptions: {
        external: [
          'vscode',
          'fs',
          'path',
          'os',
          'child_process',
          'http',
          'https',
          'buffer',
          'simple-git'
        ],
      },
    },
  };
});
