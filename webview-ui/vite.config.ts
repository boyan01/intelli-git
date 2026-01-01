import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  build: {
    outDir: '../out/webview',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'webview.js',
        assetFileNames: '[name].[ext]',
      },
    },
  },
})
