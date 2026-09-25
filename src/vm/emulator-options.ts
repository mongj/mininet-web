export const MB = 1024 * 1024;

export const MEMORY_MB_MIN = 64;
export const MEMORY_MB_MAX = 2048;
export const VGA_MEMORY_MB_MIN = 2;
export const VGA_MEMORY_MB_MAX = 32;

export const DEFAULT_CMDLINE =
  'console=ttyS0,115200 rdinit=/init random.trust_cpu=on tsc=reliable mitigations=off';

export interface EmulatorOptions {
  memory_size: number;
  vga_memory_size: number;
  disable_speaker: boolean;
  disable_mouse: boolean;
  disable_keyboard: boolean;
  cmdline: string;
}

export const DEFAULT_EMULATOR_OPTIONS: EmulatorOptions = {
  memory_size: 256 * MB,
  vga_memory_size: 2 * MB,
  disable_speaker: true,
  disable_mouse: true,
  disable_keyboard: true,
  cmdline: DEFAULT_CMDLINE,
};

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function sanitizeEmulatorOptions(
  value: Partial<EmulatorOptions> | null | undefined,
): EmulatorOptions {
  const memoryMb = Number(value?.memory_size) / MB;
  const vgaMb = Number(value?.vga_memory_size) / MB;
  const cmdline =
    typeof value?.cmdline === 'string' ? value.cmdline.trim() : '';

  return {
    memory_size:
      Number.isFinite(memoryMb) && memoryMb > 0
        ? clampInt(memoryMb, MEMORY_MB_MIN, MEMORY_MB_MAX) * MB
        : DEFAULT_EMULATOR_OPTIONS.memory_size,
    vga_memory_size:
      Number.isFinite(vgaMb) && vgaMb > 0
        ? clampInt(vgaMb, VGA_MEMORY_MB_MIN, VGA_MEMORY_MB_MAX) * MB
        : DEFAULT_EMULATOR_OPTIONS.vga_memory_size,
    disable_speaker: asBoolean(
      value?.disable_speaker,
      DEFAULT_EMULATOR_OPTIONS.disable_speaker,
    ),
    disable_mouse: asBoolean(
      value?.disable_mouse,
      DEFAULT_EMULATOR_OPTIONS.disable_mouse,
    ),
    disable_keyboard: asBoolean(
      value?.disable_keyboard,
      DEFAULT_EMULATOR_OPTIONS.disable_keyboard,
    ),
    cmdline: cmdline || DEFAULT_EMULATOR_OPTIONS.cmdline,
  };
}
