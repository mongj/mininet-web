import { cn } from 'cn';
import { MonitorIcon, MoonIcon, SettingsIcon, SunIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  useAppearance,
  type ThemePreference,
} from '@/components/theme-provider';
import {
  loadEmulatorSettings,
  saveEmulatorSettings,
  type EmulatorSettings,
} from '@/lib/emulator-settings';
import {
  MEMORY_MB_MAX,
  MEMORY_MB_MIN,
  VGA_MEMORY_MB_MAX,
  VGA_MEMORY_MB_MIN,
} from '@/vm/emulator-options';
import type { ClearPlaygroundResult } from '@/vm/opfs-storage';

const APPEARANCE_OPTIONS: ReadonlyArray<{
  id: ThemePreference;
  label: string;
}> = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'System' },
];

function appearanceIcon(id: ThemePreference) {
  switch (id) {
    case 'light':
      return SunIcon;
    case 'dark':
      return MoonIcon;
    case 'system':
      return MonitorIcon;
    default: {
      const exhaustive: never = id;
      return exhaustive;
    }
  }
}

function isEmulatorDraftDirty(
  saved: EmulatorSettings,
  memoryInput: string,
  vgaInput: string,
) {
  return (
    memoryInput !== String(saved.memoryMb) ||
    vgaInput !== String(saved.vgaMemoryMb)
  );
}

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

export function SettingsDialog({
  onResetLayout,
  onClearSavedFiles,
}: {
  onResetLayout: () => void;
  onClearSavedFiles?: () => Promise<ClearPlaygroundResult>;
}) {
  const [open, setOpen] = useState(false);
  const { appearance, setAppearance } = useAppearance();
  const [saved, setSaved] = useState(loadEmulatorSettings);
  const [memoryInput, setMemoryInput] = useState(String(saved.memoryMb));
  const [vgaInput, setVgaInput] = useState(String(saved.vgaMemoryMb));
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  const dirty = isEmulatorDraftDirty(saved, memoryInput, vgaInput);

  useEffect(() => {
    if (!open) return;
    setClearError(null);
    const loaded = loadEmulatorSettings();
    setSaved(loaded);
    setMemoryInput(String(loaded.memoryMb));
    setVgaInput(String(loaded.vgaMemoryMb));
  }, [open]);

  async function handleClearSavedFiles() {
    if (!onClearSavedFiles || clearing) return;
    setClearing(true);
    setClearError(null);
    try {
      const result = await onClearSavedFiles();
      if (result === 'cleared') setOpen(false);
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
      setOpen(false);
    } catch {
      // Keep the dialog open if persistence fails.
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label="Settings"
              onClick={() => setOpen(true)}
              size="icon-sm"
              type="button"
              variant="ghost"
            />
          }
        >
          <SettingsIcon />
        </TooltipTrigger>
        <TooltipContent>Settings</TooltipContent>
      </Tooltip>

      <DialogContent className="p-6 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <section className="mt-2 grid gap-2">
          <h3 className="text-sm font-medium">Appearance</h3>
          <div
            role="radiogroup"
            aria-label="Appearance"
            className="grid grid-cols-3 gap-2"
          >
            {APPEARANCE_OPTIONS.map((option) => {
              const selected = appearance === option.id;
              const Icon = appearanceIcon(option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setAppearance(option.id)}
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors',
                    selected
                      ? 'border-foreground/55 bg-muted/30'
                      : 'border-border hover:border-foreground/25',
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span>{option.label}</span>
                </button>
              );
            })}
          </div>
        </section>

        <Separator />

        <section className="grid gap-3">
          <h3 className="text-sm font-medium">Emulator Configuration</h3>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="memory-mb">Memory (MB)</Label>
              <Input
                id="memory-mb"
                type="number"
                inputMode="numeric"
                min={MEMORY_MB_MIN}
                max={MEMORY_MB_MAX}
                step={1}
                value={memoryInput}
                onChange={(event) => setMemoryInput(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {MEMORY_MB_MIN}–{MEMORY_MB_MAX}
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="vga-memory-mb">VGA memory (MB)</Label>
              <Input
                id="vga-memory-mb"
                type="number"
                inputMode="numeric"
                min={VGA_MEMORY_MB_MIN}
                max={VGA_MEMORY_MB_MAX}
                step={1}
                value={vgaInput}
                onChange={(event) => setVgaInput(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {VGA_MEMORY_MB_MIN}–{VGA_MEMORY_MB_MAX}
              </p>
            </div>
          </div>
        </section>

        <Separator />
        <section className="grid gap-2">
          <h3 className="text-sm font-medium">Layout</h3>
          <p className="text-xs text-muted-foreground">
            Put the panes back in their original arrangement. Open files stay
            open.
          </p>
          <Button
            onClick={() => {
              onResetLayout();
              setOpen(false);
            }}
            type="button"
            variant="outline"
          >
            Reset layout
          </Button>
        </section>

        {onClearSavedFiles ? (
          <>
            <Separator />
            <section className="grid gap-2">
              <h3 className="text-sm font-medium">Saved files</h3>
              <p className="text-xs text-muted-foreground">
                Remove files saved in /root/playground and restore the demo
                lab.py. The lab reboots if it is running.
              </p>
              <Button
                disabled={clearing}
                onClick={() => void handleClearSavedFiles()}
                type="button"
                variant="destructive"
              >
                Clear saved files
              </Button>
              {clearError ? (
                <p className="text-xs text-destructive">{clearError}</p>
              ) : null}
            </section>
          </>
        ) : null}

        <div className="flex items-center gap-3">
          {dirty ? (
            <p className="min-w-0 flex-1 text-xs text-muted-foreground">
              Configuration will be applied on the next reboot.
            </p>
          ) : null}
          <Button
            className="ml-auto w-20"
            disabled={!dirty}
            onClick={handleSave}
            type="button"
          >
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
