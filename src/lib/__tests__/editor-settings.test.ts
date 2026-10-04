import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EDITOR_SETTINGS,
  sanitizeEditorSettings,
} from '../editor-settings';

describe('editor settings', () => {
  it('leaves IntelliSense off unless it was explicitly turned on', () => {
    expect(DEFAULT_EDITOR_SETTINGS.intellisense).toBe(false);
    expect(sanitizeEditorSettings(null)).toEqual({ intellisense: false });
    expect(sanitizeEditorSettings({})).toEqual({ intellisense: false });
    expect(
      sanitizeEditorSettings({ intellisense: 'yes' as unknown as boolean }),
    ).toEqual({ intellisense: false });
    expect(sanitizeEditorSettings({ intellisense: true })).toEqual({
      intellisense: true,
    });
  });
});
