import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  loadEmulatorSettings,
  saveEmulatorSettings,
} from '@/lib/emulator-settings';
import {
  MEMORY_MB_MAX,
  MEMORY_MB_MIN,
  VGA_MEMORY_MB_MAX,
  VGA_MEMORY_MB_MIN,
} from '@/vm/emulator-options';
import type { ClearPlaygroundResult } from '@/vm/opfs-storage';

function clearErrorMessage(result: Exclude<ClearPlaygroundResult, 'cleared'>) {
  switch (result) {
    case 'busy':
      return 'Saved files are in use by another tab. Try again later.';
    case 'unavailable':
      return 'Saved files are not available in this browser.';
    default: {
      const exhaustive: never = result;
      return exhaustive;
    }
  }
}

function MegabytesField({
  id,
  label,
  min,
  max,
  value,
  onChange,
}: {
  id: string;
  label: string;
  min: number;
  max: number;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="text-xs text-muted-foreground">
        {min}–{max}
      </p>
    </div>
  );
}

/** Mounted only while the dialog is open, so each open starts from storage. */
export function EmulatorSettingsPage({
  onClearSavedFiles,
  onClose,
}: {
  onClearSavedFiles?: () => Promise<ClearPlaygroundResult>;
  onClose: () => void;
}) {
  const [saved, setSaved] = useState(loadEmulatorSettings);
  const [memoryInput, setMemoryInput] = useState(String(saved.memoryMb));
  const [vgaInput, setVgaInput] = useState(String(saved.vgaMemoryMb));
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  const dirty =
    memoryInput !== String(saved.memoryMb) ||
    vgaInput !== String(saved.vgaMemoryMb);

  async function handleClearSavedFiles() {
    if (!onClearSavedFiles || clearing) return;
    setClearing(true);
    setClearError(null);
    try {
      const result = await onClearSavedFiles();
      if (result === 'cleared') onClose();
      else setClearError(clearErrorMessage(result));
    } catch {
      setClearError('Could not clear saved files.');
    } finally {
      setClearing(false);
    }
  }

  function handleSave() {
    try {
      const next = saveEmulatorSettings({
        memoryMb: Number(memoryInput),
        vgaMemoryMb: Number(vgaInput),
      });
      setSaved(next);
      setMemoryInput(String(next.memoryMb));
      setVgaInput(String(next.vgaMemoryMb));
    } catch {
      // Keep the dialog open if persistence fails.
    }
  }

  return (
    <>
      <section className="grid gap-3">
        <h3 className="text-sm font-medium">Emulator Configuration</h3>

        <div className="grid grid-cols-2 gap-3">
          <MegabytesField
            id="memory-mb"
            label="Memory (MB)"
            min={MEMORY_MB_MIN}
            max={MEMORY_MB_MAX}
            value={memoryInput}
            onChange={setMemoryInput}
          />
          <MegabytesField
            id="vga-memory-mb"
            label="VGA memory (MB)"
            min={VGA_MEMORY_MB_MIN}
            max={VGA_MEMORY_MB_MAX}
            value={vgaInput}
            onChange={setVgaInput}
          />
        </div>

        <div className="flex items-center gap-3">
          {dirty ? (
            <p className="min-w-0 flex-1 text-xs text-muted-foreground">
              Configuration will be applied on the next reboot.
            </p>
          ) : null}
          <Button
            className="ml-auto w-24"
            disabled={!dirty}
            onClick={handleSave}
            type="button"
          >
            Save
          </Button>
        </div>
      </section>

      {onClearSavedFiles ? (
        <>
          <Separator />
          <section className="grid gap-2">
            <h3 className="text-sm font-medium">Reset emulator</h3>
            <div className="flex flex-wrap items-end gap-3">
              <p className="min-w-0 flex-1 basis-48 text-xs text-muted-foreground">
                Resets the emulator, and reboots with the latest settings if it
                is running. This will clear all your files!
              </p>
              <Button
                className="ml-auto w-24 shrink-0"
                disabled={clearing}
                onClick={() => void handleClearSavedFiles()}
                type="button"
                variant="destructive"
              >
                Reset
              </Button>
            </div>
            {clearError ? (
              <p className="text-xs text-destructive">{clearError}</p>
            ) : null}
          </section>
        </>
      ) : null}
    </>
  );
}
