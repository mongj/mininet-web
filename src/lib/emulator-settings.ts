import {
  DEFAULT_CMDLINE,
  DEFAULT_EMULATOR_OPTIONS,
  MB,
  MEMORY_MB_MAX,
  MEMORY_MB_MIN,
  VGA_MEMORY_MB_MAX,
  VGA_MEMORY_MB_MIN,
  sanitizeEmulatorOptions,
  type EmulatorOptions,
} from '@/vm/emulator-options';

export const EMULATOR_SETTINGS_KEY = 'mininet-web.emulator-settings';

export interface EmulatorSettings {
  memoryMb: number;
  vgaMemoryMb: number;
  disableSpeaker: boolean;
  disableMouse: boolean;
  disableKeyboard: boolean;
  cmdline: string;
}

export const DEFAULT_EMULATOR_SETTINGS: EmulatorSettings = {
  memoryMb: DEFAULT_EMULATOR_OPTIONS.memory_size / MB,
  vgaMemoryMb: DEFAULT_EMULATOR_OPTIONS.vga_memory_size / MB,
  disableSpeaker: DEFAULT_EMULATOR_OPTIONS.disable_speaker,
  disableMouse: DEFAULT_EMULATOR_OPTIONS.disable_mouse,
  disableKeyboard: DEFAULT_EMULATOR_OPTIONS.disable_keyboard,
  cmdline: DEFAULT_CMDLINE,
};

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function sanitizeEmulatorSettings(
  value: Partial<EmulatorSettings> | null | undefined,
): EmulatorSettings {
  const memoryMb = Number(value?.memoryMb);
  const vgaMemoryMb = Number(value?.vgaMemoryMb);
  const cmdline =
    typeof value?.cmdline === 'string' ? value.cmdline.trim() : '';

  return {
    memoryMb:
      Number.isFinite(memoryMb) && memoryMb > 0
        ? clampInt(memoryMb, MEMORY_MB_MIN, MEMORY_MB_MAX)
        : DEFAULT_EMULATOR_SETTINGS.memoryMb,
    vgaMemoryMb:
      Number.isFinite(vgaMemoryMb) && vgaMemoryMb > 0
        ? clampInt(vgaMemoryMb, VGA_MEMORY_MB_MIN, VGA_MEMORY_MB_MAX)
        : DEFAULT_EMULATOR_SETTINGS.vgaMemoryMb,
    disableSpeaker: asBoolean(
      value?.disableSpeaker,
      DEFAULT_EMULATOR_SETTINGS.disableSpeaker,
    ),
    disableMouse: asBoolean(
      value?.disableMouse,
      DEFAULT_EMULATOR_SETTINGS.disableMouse,
    ),
    disableKeyboard: asBoolean(
      value?.disableKeyboard,
      DEFAULT_EMULATOR_SETTINGS.disableKeyboard,
    ),
    cmdline: cmdline || DEFAULT_EMULATOR_SETTINGS.cmdline,
  };
}

export function settingsToOptions(settings: EmulatorSettings): EmulatorOptions {
  const next = sanitizeEmulatorSettings(settings);
  return sanitizeEmulatorOptions({
    memory_size: next.memoryMb * MB,
    vga_memory_size: next.vgaMemoryMb * MB,
    disable_speaker: next.disableSpeaker,
    disable_mouse: next.disableMouse,
    disable_keyboard: next.disableKeyboard,
    cmdline: next.cmdline,
  });
}

export function loadEmulatorSettings(): EmulatorSettings {
  if (typeof localStorage === 'undefined') return DEFAULT_EMULATOR_SETTINGS;
  try {
    const raw = localStorage.getItem(EMULATOR_SETTINGS_KEY);
    if (!raw) return DEFAULT_EMULATOR_SETTINGS;
    return sanitizeEmulatorSettings(
      JSON.parse(raw) as Partial<EmulatorSettings>,
    );
  } catch {
    return DEFAULT_EMULATOR_SETTINGS;
  }
}

export function saveEmulatorSettings(
  settings: Partial<EmulatorSettings>,
): EmulatorSettings {
  const next = sanitizeEmulatorSettings({
    ...loadEmulatorSettings(),
    ...settings,
  });
  localStorage.setItem(EMULATOR_SETTINGS_KEY, JSON.stringify(next));
  return next;
}

export function loadEmulatorOptions(): EmulatorOptions {
  return settingsToOptions(loadEmulatorSettings());
}
