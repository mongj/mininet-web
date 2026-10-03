import { baseName } from '@/lib/paths';

export type Monaco = typeof import('monaco-editor/editor/editor.api');

let loading: Promise<Monaco> | undefined;

/** Loads Monaco the first time a file is opened, then reuses it. */
export function loadMonaco(): Promise<Monaco> {
  loading ??= import('./monaco-setup').then((module) => module.monaco);
  return loading;
}

// Defined by monaco-setup; named here so choosing one does not load Monaco.
export const LIGHT_THEME = 'mininet-light';
export const DARK_THEME = 'mininet-dark';

export function monacoTheme(appearance: 'light' | 'dark'): string {
  return appearance === 'dark' ? DARK_THEME : LIGHT_THEME;
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  py: 'python',
  sh: 'shell',
  bash: 'shell',
  json: 'json',
  md: 'markdown',
  markdown: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  xml: 'xml',
};

/** Picks a language from the file name, then from a `#!` first line. */
export function languageFor(path: string, text: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf('.');
  if (dot > 0) {
    const language = LANGUAGE_BY_EXTENSION[name.slice(dot + 1).toLowerCase()];
    if (language) return language;
  }
  const firstLine = text.slice(0, text.indexOf('\n') >>> 0).slice(0, 200);
  if (firstLine.startsWith('#!')) {
    if (/\bpython[0-9.]*\b/.test(firstLine)) return 'python';
    if (/\b(ba|da|z|k)?sh\b/.test(firstLine)) return 'shell';
  }
  return 'plaintext';
}
