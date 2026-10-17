import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vite.dev/config/
export default defineConfig({
    envDir: path.resolve(__dirname, '../..'),
    plugins: [react()],
    base: './',
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
});
