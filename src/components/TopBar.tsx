import { cn } from 'cn';
import {
  CircleHelpIcon,
  RotateCwIcon,
  SmartphoneIcon,
  TriangleAlertIcon,
  XIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import githubDark from '@/assets/logos/github-dark.svg';
import githubLight from '@/assets/logos/github-light.svg';
import { SettingsDialog } from '@/components/SettingsDialog';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverArrow,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { IntelliSenseStatus } from '@/editor/intellisense/intellisense';
import { useIsMobile } from '@/hooks/useIsMobile';
import { isBooted } from '@/hooks/useVirtualMachine';
import { saveEditorSettings, useEditorSettings } from '@/lib/editor-settings';
import {
  hasSeenIntelliSenseHint,
  rememberIntelliSenseHint,
} from '@/lib/intellisense-hint';
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

const MOBILE_NOTICE_KEY = 'mininet-web:mobile-notice';

function mobileNoticeDismissed(): boolean {
  try {
    return sessionStorage.getItem(MOBILE_NOTICE_KEY) === '1';
  } catch (error) {
    console.error(error);
    return false;
  }
}

function dismissMobileNotice(): void {
  try {
    sessionStorage.setItem(MOBILE_NOTICE_KEY, '1');
  } catch (error) {
    console.error(error);
  }
}

/** Shown once per tab while the viewport is narrow, until dismissed. */
function MobileNotice() {
  const mobile = useIsMobile();
  const [dismissed, setDismissed] = useState(mobileNoticeDismissed);
  if (!mobile || dismissed) return null;
  return (
    <div
      role="alert"
      className="mx-1.5 mb-1.5 flex shrink-0 items-start gap-2 rounded-[10px] border border-amber-500/30 bg-amber-500/10 py-1.5 pr-1.5 pl-3 text-xs"
    >
      <SmartphoneIcon className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
      <p className="min-w-0 flex-1 py-0.5">
        <span className="font-medium">You're on a small screen.</span>{' '}
        <span className="text-muted-foreground">
          This app is built for desktop, and will be quite hard to use on
          mobile.
        </span>
      </p>
      <Button
        aria-label="Dismiss"
        size="icon-xs"
        variant="ghost"
        onClick={() => {
          dismissMobileNotice();
          setDismissed(true);
        }}
      >
        <XIcon />
      </Button>
    </div>
  );
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

function intelliSenseHint(status: IntelliSenseStatus, enabled: boolean) {
  if (!enabled) return 'Turn on Python completions, hovers and error checking';
  switch (status) {
    case 'off':
      return 'IntelliSense starts when a Python file is open';
    case 'starting':
      return 'IntelliSense is starting…';
    case 'ready':
      return 'IntelliSense is on for Python files';
    case 'error':
      return 'IntelliSense could not start. Turn it off and on to retry.';
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

/** Shown while a file is open: turns the Python language server on and off. */
function IntelliSenseToggle() {
  const { intellisense } = useWorkspace();
  const { intellisense: enabled } = useEditorSettings();
  const failed = enabled && intellisense.status === 'error';
  const [hintOpen, setHintOpen] = useState(
    () => !enabled && !hasSeenIntelliSenseHint(),
  );

  useEffect(() => {
    if (!hintOpen) {
      rememberIntelliSenseHint();
      return;
    }
    // A timeout survives Strict Mode's setup/cleanup, which would otherwise
    // record the hint before the remounted toggle can show it.
    const id = window.setTimeout(rememberIntelliSenseHint, 0);
    return () => window.clearTimeout(id);
  }, [hintOpen]);

  useEffect(() => {
    if (!enabled) return;
    rememberIntelliSenseHint();
    setHintOpen(false);
  }, [enabled]);

  function dismissHint() {
    rememberIntelliSenseHint();
    setHintOpen(false);
  }

  function toggleIntelliSense() {
    saveEditorSettings({ intellisense: !enabled });
    dismissHint();
  }

  return (
    <Popover
      open={hintOpen}
      onOpenChange={(open) => {
        if (!open) dismissHint();
      }}
    >
      <Tooltip disabled={hintOpen}>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  role="switch"
                  aria-checked={enabled}
                  data-status={enabled ? intellisense.status : 'off'}
                  onClick={toggleIntelliSense}
                  size="sm"
                  type="button"
                  variant="ghost"
                />
              }
            />
          }
        >
          <span
            aria-hidden
            data-icon="inline-start"
            className={cn(
              'size-2 rounded-full',
              !enabled
                ? 'bg-muted-foreground/40'
                : failed
                  ? 'bg-destructive'
                  : 'bg-emerald-500',
              enabled && intellisense.status === 'starting' && 'animate-pulse',
            )}
          />
          IntelliSense
        </TooltipTrigger>
        <TooltipContent>
          {intelliSenseHint(intellisense.status, enabled)}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        side="bottom"
        align="center"
        sideOffset={10}
        initialFocus={false}
        finalFocus={false}
        className="w-64 rounded-md bg-foreground px-3 py-2 pr-7 text-xs text-background shadow-none ring-0"
      >
        <div className="flex flex-col gap-1">
          <PopoverTitle>Turn on IntelliSense here</PopoverTitle>
          <PopoverDescription className="text-xs leading-relaxed text-background">
            Turn it on if you want syntax highlighting, completions, and error
            checking.
          </PopoverDescription>
        </div>
        <PopoverClose
          aria-label="Dismiss"
          render={
            <Button
              size="icon-xs"
              variant="ghost"
              className="absolute top-1 right-1 text-background hover:bg-background/10 hover:text-background"
            />
          }
        >
          <XIcon />
        </PopoverClose>
        <PopoverArrow className="bg-foreground fill-foreground" />
      </PopoverContent>
    </Popover>
  );
}

export function TopBar() {
  const { vm, boot, showWelcome, resetLayout, hasOpenFiles } = useWorkspace();
  const booted = isBooted(vm.phase);
  return (
    <>
      <header className="flex h-11 shrink-0 items-center gap-2 px-3">
        <img alt="" src="favicon.svg" className="size-5 shrink-0" />
        <h1 className="truncate text-sm font-medium tracking-tight">
          Mininet Web Playground
        </h1>
        <a
          aria-label="View source on GitHub"
          href="https://github.com/mongj/mininet-web"
          target="_blank"
          rel="noreferrer"
          className="ml-1 shrink-0 opacity-70 transition-opacity hover:opacity-100"
        >
          <img alt="" src={githubLight} className="size-4 dark:hidden" />
          <img alt="" src={githubDark} className="hidden size-4 dark:block" />
        </a>
        <div className="flex-1" />
        {hasOpenFiles ? <IntelliSenseToggle /> : null}
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
      <MobileNotice />
      {vm.storage?.persistent === false ? (
        // Keyed so that a new warning shows even after the last was dismissed.
        <StorageBanner key={vm.storage.reason} reason={vm.storage.reason} />
      ) : null}
    </>
  );
}
