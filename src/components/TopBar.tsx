import {
  CircleHelpIcon,
  RotateCwIcon,
  TriangleAlertIcon,
  XIcon,
} from 'lucide-react';
import { useState } from 'react';
import { SettingsDialog } from '@/components/SettingsDialog';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { isBooted } from '@/hooks/useVirtualMachine';
import type { StorageReason } from '@/vm/messages';
import { useWorkspace } from '@/workspace/context';

function storageWarning(reason: StorageReason): {
  title: string;
  body: string;
} {
  switch (reason) {
    case 'locked':
      return {
        title: 'Mininet Web is already open in another tab',
        body: 'Your saved playground files are in use over there, so this session will use in-memory storage instead. Changes here will be lost when you reload. Close the other tab and restart to use your saved files.',
      };
    case 'unavailable':
      return {
        title: 'Persistent storage is not available',
        body: 'The platform uses OPFS for persistent storage, but your browser does not support it. As such, this session will use in-memory storage. Changes will be lost when you reload.',
      };
    case 'mount-failed':
      return {
        title: 'Saved files could not be mounted',
        body: 'Linux could not open your saved playground files, so this session will use in-memory storage. Changes will be lost when you reload.',
      };
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

function StorageBanner({ reason }: { reason: StorageReason }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  const warning = storageWarning(reason);
  return (
    <div
      role="alert"
      className="mx-1.5 mb-1.5 flex shrink-0 items-start gap-2 rounded-[10px] border border-amber-500/30 bg-amber-500/10 py-1.5 pr-1.5 pl-3 text-xs"
    >
      <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
      <p className="min-w-0 flex-1 py-0.5">
        <span className="font-medium">{warning.title}.</span>{' '}
        <span className="text-muted-foreground">{warning.body}</span>
      </p>
      <Button
        aria-label="Dismiss"
        size="icon-xs"
        variant="ghost"
        onClick={() => setDismissed(true)}
      >
        <XIcon />
      </Button>
    </div>
  );
}

export function TopBar() {
  const { vm, boot, showWelcome, resetLayout } = useWorkspace();
  const booted = isBooted(vm.phase);
  return (
    <>
      <header className="flex h-11 shrink-0 items-center gap-2 px-3">
        <img alt="" src="favicon.svg" className="size-5 shrink-0" />
        <h1 className="truncate text-sm font-medium tracking-tight">
          Mininet Web Playground
        </h1>
        <div className="flex-1" />
        <Button onClick={showWelcome} size="sm" type="button" variant="ghost">
          <CircleHelpIcon data-icon="inline-start" />
          Help
        </Button>
        {booted ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  id="restart"
                  onClick={boot}
                  size="sm"
                  type="button"
                  variant="destructive"
                />
              }
            >
              <RotateCwIcon data-icon="inline-start" />
              Reboot
            </TooltipTrigger>
            <TooltipContent>Discard this session and reboot</TooltipContent>
          </Tooltip>
        ) : null}
        <SettingsDialog
          onResetLayout={resetLayout}
          onClearSavedFiles={
            vm.storage?.persistent === false && vm.storage.reason === 'locked'
              ? undefined
              : vm.resetSavedFiles
          }
        />
      </header>
      {vm.storage?.persistent === false ? (
        // Keyed so that a new warning shows even after the last was dismissed.
        <StorageBanner key={vm.storage.reason} reason={vm.storage.reason} />
      ) : null}
    </>
  );
}
