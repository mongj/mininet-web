// Loaded on demand through `loadMonaco`. Importing the editor core, its
// features and a handful of languages separately keeps the other ~80 language
// grammars out of the bundle.
import 'monaco-editor/features/register.all';
// Not part of the set above: colours tokens from a language server.
import 'monaco-editor/editor/contrib/semanticTokens/browser/documentSemanticTokens';
import 'monaco-editor/languages/definitions/python/register';
import 'monaco-editor/languages/definitions/shell/register';
import 'monaco-editor/languages/definitions/markdown/register';
import 'monaco-editor/languages/definitions/yaml/register';
import 'monaco-editor/languages/definitions/ini/register';
import 'monaco-editor/languages/definitions/xml/register';
import 'monaco-editor/languages/features/json/register';
import * as monaco from 'monaco-editor/editor/editor.api';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
import { DARK_THEME, LIGHT_THEME } from './monaco';

self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    return label === 'json' ? new JsonWorker() : new EditorWorker();
  },
};

// Match the editor surface to the app's `--background` in each appearance.
// The rules colour the language server's semantic tokens, after VS Code.
monaco.editor.defineTheme(LIGHT_THEME, {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'namespace', foreground: '267f99' },
    { token: 'class', foreground: '267f99' },
    { token: 'enum', foreground: '267f99' },
    { token: 'typeParameter', foreground: '267f99' },
    { token: 'function', foreground: '795e26' },
    { token: 'method', foreground: '795e26' },
    { token: 'decorator', foreground: '795e26' },
    { token: 'parameter', foreground: '001080' },
    { token: 'property', foreground: '001080' },
    { token: 'enumMember', foreground: '0070c1' },
    { token: 'selfParameter', foreground: '0000ff' },
    { token: 'clsParameter', foreground: '0000ff' },
  ],
  colors: {
    'editor.background': '#ffffff',
    'editorGutter.background': '#ffffff',
    'editorStickyScroll.background': '#ffffff',
  },
});
monaco.editor.defineTheme(DARK_THEME, {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'namespace', foreground: '4ec9b0' },
    { token: 'class', foreground: '4ec9b0' },
    { token: 'enum', foreground: '4ec9b0' },
    { token: 'typeParameter', foreground: '4ec9b0' },
    { token: 'function', foreground: 'dcdcaa' },
    { token: 'method', foreground: 'dcdcaa' },
    { token: 'decorator', foreground: 'dcdcaa' },
    { token: 'parameter', foreground: '9cdcfe' },
    { token: 'property', foreground: '9cdcfe' },
    { token: 'enumMember', foreground: '4fc1ff' },
    { token: 'selfParameter', foreground: '569cd6' },
    { token: 'clsParameter', foreground: '569cd6' },
  ],
  colors: {
    'editor.background': '#191919',
    'editorGutter.background': '#191919',
    'editorStickyScroll.background': '#191919',
    'editorWidget.background': '#222222',
  },
});

// Monaco measures glyphs once; measure again when the web font has loaded.
void document.fonts.ready.then(() => monaco.editor.remeasureFonts());

export { monaco };
