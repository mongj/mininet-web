// Loaded on demand through `loadMonaco`. Importing the editor core, its
// features and a handful of languages separately keeps the other ~80 language
// grammars out of the bundle.
import 'monaco-editor/features/register.all';
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
monaco.editor.defineTheme(LIGHT_THEME, {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#ffffff',
    'editorGutter.background': '#ffffff',
    'editorStickyScroll.background': '#ffffff',
  },
});
monaco.editor.defineTheme(DARK_THEME, {
  base: 'vs-dark',
  inherit: true,
  rules: [],
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
