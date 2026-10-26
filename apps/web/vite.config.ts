import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // 开发时直接用规则源码，避免每次改完还要先 build dist
      '@order-board/rules': path.resolve(__dirname, '../../packages/rules/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3789',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:3789',
        ws: true,
      },
    },
  },
});
