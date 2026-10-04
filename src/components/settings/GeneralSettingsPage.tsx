import { cn } from 'cn';
import { MonitorIcon, MoonIcon, SunIcon, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  useAppearance,
  type ThemePreference,
} from '@/components/theme-provider';

const APPEARANCE_OPTIONS: ReadonlyArray<{
  id: ThemePreference;
  label: string;
  Icon: LucideIcon;
}> = [
  { id: 'light', label: 'Light', Icon: SunIcon },
  { id: 'dark', label: 'Dark', Icon: MoonIcon },
  { id: 'system', label: 'System', Icon: MonitorIcon },
];

export function GeneralSettingsPage({
  onResetLayout,
  onClose,
}: {
  onResetLayout: () => void;
  onClose: () => void;
}) {
  const { appearance, setAppearance } = useAppearance();

  return (
    <>
      <section className="grid gap-2">
        <h3 className="text-sm font-medium">Appearance</h3>
        <div
          role="radiogroup"
          aria-label="Appearance"
          className="grid grid-cols-3 gap-2"
        >
          {APPEARANCE_OPTIONS.map(({ id, label, Icon }) => {
            const selected = appearance === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setAppearance(id)}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors',
                  selected
                    ? 'border-foreground/55 bg-muted/30'
                    : 'border-border hover:border-foreground/25',
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span>{label}</span>
              </button>
            );
          })}
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
            onClose();
          }}
          type="button"
          variant="outline"
        >
          Reset layout
        </Button>
      </section>
    </>
  );
}
