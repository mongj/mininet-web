import { cn } from 'cn';
import { MonitorIcon, MoonIcon, SunIcon, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import {
  useAppearance,
  type ThemePreference,
} from '@/components/theme-provider';
import { saveEditorSettings, useEditorSettings } from '@/lib/editor-settings';

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
  const editor = useEditorSettings();

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
        <h3 className="text-sm font-medium">Editor</h3>
        <div className="flex items-start gap-4">
          <div className="grid min-w-0 flex-1 gap-1">
            <Label htmlFor="intellisense" className="font-normal">
              IntelliSense
            </Label>
            <p className="text-xs text-muted-foreground">
              Code completions, hover documentation and error checking for
              Python files, including the Mininet API. Downloads about 3 MB the
              first time and uses about 500 MB of memory while it is on.
            </p>
          </div>
          <Switch
            id="intellisense"
            checked={editor.intellisense}
            onCheckedChange={(checked) =>
              saveEditorSettings({ intellisense: checked })
            }
          />
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
