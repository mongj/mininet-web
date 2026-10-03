import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(root, 'src'),
    },
  },
  worker: { format: 'es' },
  // Monaco is imported lazily, so the dev server would otherwise discover it
  // on the first file open and re-bundle its dependencies mid-session, which
  // breaks the language chunks already requested. Bundle its entries up front.
  optimizeDeps: {
    include: [
      'monaco-editor/features/register.all',
      'monaco-editor/languages/definitions/python/register',
      'monaco-editor/languages/definitions/shell/register',
      'monaco-editor/languages/definitions/markdown/register',
      'monaco-editor/languages/definitions/yaml/register',
      'monaco-editor/languages/definitions/ini/register',
      'monaco-editor/languages/definitions/xml/register',
      'monaco-editor/languages/features/json/register',
      'monaco-editor/editor/editor.api',
    ],
  },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
