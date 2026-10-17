import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores([
    'dist',
    'public',
    '.cache',
    '.wrangler',
    '.yarn',
    'verification',
  ]),
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['src/vm/emulator.worker.ts'],
    languageOptions: { globals: globals.worker },
  },
  {
    files: ['scripts/**', '*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
    rules: { 'no-control-regex': 'off' },
  },
  {
    files: ['**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
]);
