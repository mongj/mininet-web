import { Tabs } from '@base-ui/react/tabs';
import { CpuIcon, Settings2Icon, SettingsIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { EmulatorSettingsPage } from '@/components/settings/EmulatorSettingsPage';
import { GeneralSettingsPage } from '@/components/settings/GeneralSettingsPage';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { ClearPlaygroundResult } from '@/vm/opfs-storage';

const SETTINGS_SECTIONS = [
  { id: 'general', label: 'General', Icon: Settings2Icon },
  { id: 'emulator', label: 'Emulator', Icon: CpuIcon },
] as const;

type SettingsSection = (typeof SETTINGS_SECTIONS)[number]['id'];

/** Stays mounted while hidden so a page keeps its draft across tab switches. */
function SettingsPanel({
  value,
  children,
}: {
  value: SettingsSection;
  children: ReactNode;
}) {
  return (
    <Tabs.Panel
      value={value}
      keepMounted
      className="min-h-0 flex-1 overflow-y-auto p-6"
    >
      <div className="flex flex-col gap-4">{children}</div>
    </Tabs.Panel>
  );
}

type SettingsDialogProps = {
  onResetLayout: () => void;
  onClearSavedFiles?: () => Promise<ClearPlaygroundResult>;
};

/** Mounted only while the dialog is open, so each open starts on General. */
function SettingsDialogBody({
  onResetLayout,
  onClearSavedFiles,
  onClose,
}: SettingsDialogProps & { onClose: () => void }) {
  const [section, setSection] = useState<SettingsSection>('general');
  const title = SETTINGS_SECTIONS.find((item) => item.id === section)?.label;

  return (
    <Tabs.Root
      orientation="vertical"
      value={section}
      onValueChange={setSection}
      className="flex h-full min-h-0"
    >
      <div className="flex w-40 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-2 pt-3.25 text-sidebar-foreground">
        <p className="flex h-8 shrink-0 items-center px-2 text-xs font-medium text-sidebar-foreground/70">
          Settings
        </p>
        <Tabs.List
          activateOnFocus
          aria-label="Settings sections"
          className="flex flex-col gap-1"
        >
          {SETTINGS_SECTIONS.map(({ id, label, Icon }) => (
            <Tabs.Tab
              key={id}
              value={id}
              className="flex h-8 w-full items-center gap-2 rounded-md p-2 text-left text-sm ring-sidebar-ring outline-hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground data-active:bg-sidebar-accent data-active:font-medium data-active:text-sidebar-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0"
            >
              <Icon />
              <span>{label}</span>
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <DialogHeader className="shrink-0 px-6 pt-6">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <SettingsPanel value="general">
          <GeneralSettingsPage
            onResetLayout={onResetLayout}
            onClose={onClose}
          />
        </SettingsPanel>
        <SettingsPanel value="emulator">
          <EmulatorSettingsPage
            onClearSavedFiles={onClearSavedFiles}
            onClose={onClose}
          />
        </SettingsPanel>
      </div>
    </Tabs.Root>
  );
}

export function SettingsDialog(props: SettingsDialogProps) {
  const [open, setOpen] = useState(false);

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

      <DialogContent className="h-[32rem] max-h-[calc(100svh-2rem)] w-[min(42rem,calc(100%-2rem))] max-w-none gap-0 overflow-hidden p-0 sm:max-w-none">
        <SettingsDialogBody {...props} onClose={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
