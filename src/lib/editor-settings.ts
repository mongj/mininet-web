import { useSyncExternalStore } from 'react';

export const EDITOR_SETTINGS_KEY = 'mininet-web.editor-settings';

export interface EditorSettings {
  /** Python completions, hovers and error checking from a language server. */
  intellisense: boolean;
}

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  intellisense: false,
};

export function sanitizeEditorSettings(
  value: Partial<EditorSettings> | null | undefined,
): EditorSettings {
  return {
    intellisense:
      typeof value?.intellisense === 'boolean'
        ? value.intellisense
        : DEFAULT_EDITOR_SETTINGS.intellisense,
  };
}

function readEditorSettings(): EditorSettings {
  if (typeof localStorage === 'undefined') return DEFAULT_EDITOR_SETTINGS;
  try {
    const raw = localStorage.getItem(EDITOR_SETTINGS_KEY);
    if (!raw) return DEFAULT_EDITOR_SETTINGS;
    return sanitizeEditorSettings(JSON.parse(raw) as Partial<EditorSettings>);
  } catch {
    return DEFAULT_EDITOR_SETTINGS;
  }
}

// Read once and kept here, so every reader sees a change as soon as it is made.
let current: EditorSettings | undefined;
const listeners = new Set<() => void>();

export function loadEditorSettings(): EditorSettings {
  current ??= readEditorSettings();
  return current;
}

/** Applies `settings` right away; they are kept even if storing them fails. */
export function saveEditorSettings(
  settings: Partial<EditorSettings>,
): EditorSettings {
  current = sanitizeEditorSettings({ ...loadEditorSettings(), ...settings });
  try {
    localStorage.setItem(EDITOR_SETTINGS_KEY, JSON.stringify(current));
  } catch (error) {
    console.error(error);
  }
  for (const listener of [...listeners]) listener();
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useEditorSettings(): EditorSettings {
  return useSyncExternalStore(subscribe, loadEditorSettings);
}
