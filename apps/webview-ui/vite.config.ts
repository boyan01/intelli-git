import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import replace from '@rollup/plugin-replace'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const repoRoot = path.resolve(__dirname, '../..');
  const env = loadEnv(mode, repoRoot, '');
  const daysAgo = parseFloat(env.DEBUG_BUILD_DAYS_AGO || '0');
  const finalBuildTime = Date.now() - (daysAgo * 24 * 60 * 60 * 1000);

  return {
    envDir: repoRoot,
    plugins: [
      react(),
      replace({
        __IS_EXPIRED__: `(Date.now() - ${finalBuildTime} > 30 * 24 * 60 * 60 * 1000)`,
        preventAssignment: true,
      }),
    ],
    base: './',
    define: {
      __BUILD_TIME__: JSON.stringify(finalBuildTime),
    },
    resolve: {
      alias: {
        '@shared': path.resolve(__dirname, '../../packages/shared'),
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      chunkSizeWarningLimit: 1000,
      outDir: '../extension/out/webview',
      emptyOutDir: true,
      minify: 'esbuild',
      sourcemap: true,
      rollupOptions: {
        output: {
          entryFileNames: 'webview.js',
          assetFileNames: '[name].[ext]',
        },
      },
    },
  };
})
