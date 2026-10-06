import { Tabs } from '@base-ui/react/tabs';
import { cn } from 'cn';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CpuIcon,
  Settings2Icon,
  SettingsIcon,
} from 'lucide-react';
import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { EmulatorSettingsPage } from '@/components/settings/EmulatorSettingsPage';
import { GeneralSettingsPage } from '@/components/settings/GeneralSettingsPage';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Button, buttonVariants } from '@/components/ui/button';
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

type MobileSettingsPage = 'list' | 'detail';

function settingsSectionLabel(section: SettingsSection): string {
  switch (section) {
    case 'general':
      return 'General';
    case 'emulator':
      return 'Emulator';
    default: {
      const exhaustive: never = section;
      return exhaustive;
    }
  }
}

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

type SettingsPageProps = SettingsDialogProps & { onClose: () => void };

function SettingsSectionBody({
  section,
  onResetLayout,
  onClearSavedFiles,
  onClose,
}: SettingsPageProps & { section: SettingsSection }) {
  switch (section) {
    case 'general':
      return (
        <GeneralSettingsPage onResetLayout={onResetLayout} onClose={onClose} />
      );
    case 'emulator':
      return (
        <EmulatorSettingsPage
          onClearSavedFiles={onClearSavedFiles}
          onClose={onClose}
        />
      );
    default: {
      const exhaustive: never = section;
      return exhaustive;
    }
  }
}

function DesktopSettings({
  section,
  onSectionChange,
  ...pageProps
}: SettingsPageProps & {
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
}) {
  return (
    <Tabs.Root
      orientation="vertical"
      value={section}
      onValueChange={onSectionChange}
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
          <DialogTitle>{settingsSectionLabel(section)}</DialogTitle>
        </DialogHeader>
        {SETTINGS_SECTIONS.map((item) => (
          <SettingsPanel key={item.id} value={item.id}>
            <SettingsSectionBody section={item.id} {...pageProps} />
          </SettingsPanel>
        ))}
      </div>
    </Tabs.Root>
  );
}

function MobileSettingsHeader({
  page,
  section,
  onBack,
  backRef,
}: {
  page: MobileSettingsPage;
  section: SettingsSection;
  onBack: () => void;
  backRef: RefObject<HTMLButtonElement | null>;
}) {
  switch (page) {
    case 'list':
      return (
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4">
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
      );
    case 'detail':
      return (
        <DialogHeader className="shrink-0 flex-row items-center gap-1 px-3 pt-5 pr-14">
          <button
            ref={backRef}
            type="button"
            aria-label="Back"
            onClick={onBack}
            className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
          >
            <ChevronLeftIcon />
          </button>
          <DialogTitle className="min-w-0 truncate">
            {settingsSectionLabel(section)}
          </DialogTitle>
        </DialogHeader>
      );
    default: {
      const exhaustive: never = page;
      return exhaustive;
    }
  }
}

function MobileSettings({
  page,
  section,
  onOpenSection,
  onBack,
  ...pageProps
}: SettingsPageProps & {
  page: MobileSettingsPage;
  section: SettingsSection;
  onOpenSection: (section: SettingsSection) => void;
  onBack: () => void;
}) {
  const backRef = useRef<HTMLButtonElement>(null);
  const rowRefs = useRef(new Map<SettingsSection, HTMLButtonElement>());
  const pendingFocus = useRef<'back' | SettingsSection | null>(null);

  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    pendingFocus.current = null;
    if (pending === 'back') {
      backRef.current?.focus();
      return;
    }
    if (pending) rowRefs.current.get(pending)?.focus();
  }, [page]);

  function openSection(next: SettingsSection) {
    pendingFocus.current = 'back';
    onOpenSection(next);
  }

  function goBack() {
    pendingFocus.current = section;
    onBack();
  }

  const showingList = page === 'list';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <MobileSettingsHeader
        page={page}
        section={section}
        onBack={goBack}
        backRef={backRef}
      />
      <nav
        aria-label="Settings sections"
        className={cn(
          'min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-4',
          !showingList && 'hidden',
        )}
      >
        <ul className="overflow-hidden rounded-xl bg-secondary text-secondary-foreground">
          {SETTINGS_SECTIONS.map(({ id, label, Icon }) => (
            <li key={id} className="border-b border-border last:border-b-0">
              <button
                ref={(node) => {
                  if (node) rowRefs.current.set(id, node);
                  else rowRefs.current.delete(id);
                }}
                type="button"
                onClick={() => openSection(id)}
                className="flex min-h-11 w-full items-center gap-3 px-4 text-left text-sm ring-ring outline-hidden hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-inset active:bg-foreground/10 [&_svg]:size-4 [&_svg]:shrink-0"
              >
                <Icon />
                <span className="min-w-0 flex-1">{label}</span>
                <ChevronRightIcon className="text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div
        className={cn('flex min-h-0 flex-1 flex-col', showingList && 'hidden')}
      >
        {SETTINGS_SECTIONS.map((item) => (
          <div
            key={item.id}
            className={cn(
              'min-h-0 flex-1 overflow-y-auto p-6',
              section === item.id ? 'block' : 'hidden',
            )}
          >
            <div className="flex flex-col gap-4">
              <SettingsSectionBody section={item.id} {...pageProps} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Mounted only while the dialog is open. Desktop starts on General; mobile starts on the section list. */
function SettingsDialogBody({
  onResetLayout,
  onClearSavedFiles,
  onClose,
}: SettingsPageProps) {
  const narrow = useIsMobile();
  const [section, setSection] = useState<SettingsSection>('general');
  const [mobilePage, setMobilePage] = useState<MobileSettingsPage>('list');
  const pageProps = { onResetLayout, onClearSavedFiles, onClose };

  if (narrow) {
    return (
      <MobileSettings
        {...pageProps}
        page={mobilePage}
        section={section}
        onOpenSection={(next) => {
          setSection(next);
          setMobilePage('detail');
        }}
        onBack={() => setMobilePage('list')}
      />
    );
  }

  return (
    <DesktopSettings
      {...pageProps}
      section={section}
      onSectionChange={setSection}
    />
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

      <DialogContent className="h-128 max-h-[calc(100svh-2rem)] w-[min(42rem,calc(100%-2rem))] max-w-lg gap-0 overflow-hidden p-0 sm:max-w-lg md:max-w-none">
        <SettingsDialogBody {...props} onClose={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
