import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const MONACO_ENV_MODULE_ID = 'virtual:intelli-git-monaco-env';
const RESOLVED_MONACO_ENV_MODULE_ID = `\0${MONACO_ENV_MODULE_ID}`;

function monacoWorkers(): Plugin {
  let entryId = '';

  return {
    name: 'intelli-git-monaco-workers',
    enforce: 'pre',
    configResolved(config) {
      entryId = path.resolve(config.root, 'src/main.tsx').replace(/\\/g, '/');
    },
    resolveId(id) {
      return id === MONACO_ENV_MODULE_ID ? RESOLVED_MONACO_ENV_MODULE_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_MONACO_ENV_MODULE_ID) {
        return null;
      }

      return [
        "import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker&inline';",
        '',
        'self.MonacoEnvironment = {',
        '  getWorker() {',
        '    return new EditorWorker();',
        '  },',
        '};',
        '',
      ].join('\n');
    },
    transform(code, id) {
      const normalizedId = id.replace(/\\/g, '/').split('?')[0];
      if (normalizedId !== entryId || code.includes(MONACO_ENV_MODULE_ID)) {
        return null;
      }

      return {
        code: `import ${JSON.stringify(MONACO_ENV_MODULE_ID)};\n${code}`,
        map: null,
      };
    },
  };
}

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
  const expirationExpression = `(Date.now() - ${finalBuildTime} > 180 * 24 * 60 * 60 * 1000)`;

  return {
    envDir: repoRoot,
    plugins: [
      monacoWorkers(),
      react(),
    ],
    base: './',
    define: {
      __BUILD_TIME__: JSON.stringify(String(finalBuildTime)),
      __BUILD_CHANNEL__: JSON.stringify(buildChannel),
      __IS_DEV_BUILD__: JSON.stringify(isDevBuild),
      __IS_EXPIRED__: expirationExpression,
    },
    resolve: {
      alias: {
        '@shared': path.resolve(__dirname, '../../packages/shared'),
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      chunkSizeWarningLimit: 5000,
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
