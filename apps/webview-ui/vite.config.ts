import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

function resolveBuildChannel(value: string | undefined, mode: string): 'marketplace' | 'dev' {
  if (value === 'dev' || value === 'marketplace') {
    return value;
  }
  return mode === 'dev' ? 'dev' : 'marketplace';
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const repoRoot = path.resolve(__dirname, '../..');
  const effectiveMode = process.env.MODE || mode;
  const env = loadEnv(effectiveMode, repoRoot, '');
  const buildChannel = resolveBuildChannel(process.env.INTELLI_GIT_BUILD_CHANNEL || env.INTELLI_GIT_BUILD_CHANNEL, effectiveMode);
  const isDevBuild = buildChannel === 'dev';
  const daysAgo = parseFloat(env.DEBUG_BUILD_DAYS_AGO || '0');
  const finalBuildTime = Date.now() - (daysAgo * 24 * 60 * 60 * 1000);
  const expirationExpression = `(Date.now() - ${finalBuildTime} > 30 * 24 * 60 * 60 * 1000)`;

  return {
    envDir: repoRoot,
    plugins: [
      react(),
    ],
    base: './',
    define: {
      __BUILD_TIME__: JSON.stringify(String(finalBuildTime)),
      __BUILD_CHANNEL__: JSON.stringify(buildChannel),
      __IS_DEV_BUILD__: JSON.stringify(isDevBuild),
      __IS_EXPIRED__: isDevBuild ? expirationExpression : 'false',
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
      sourcemap: false,
      rollupOptions: {
        output: {
          entryFileNames: 'webview.js',
          assetFileNames: '[name].[ext]',
        },
      },
    },
  };
})
