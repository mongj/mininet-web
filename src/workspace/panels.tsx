import type {
  DockviewPanelApi,
  IDockviewHeaderActionsProps,
  IDockviewPanelHeaderProps,
  IDockviewPanelProps,
} from 'dockview-react';
import {
  FolderTreeIcon,
  Maximize2Icon,
  Minimize2Icon,
  SparklesIcon,
  TerminalIcon,
  XIcon,
} from 'lucide-react';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Credits } from '@/components/Credits';
import { FileTypeIcon } from '@/components/FileTypeIcon';
import { TerminalView } from '@/components/Terminal';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { CodeEditor } from '@/editor/CodeEditor';
import { MAX_EDITABLE_BYTES } from '@/editor/documents';
import { Explorer } from '@/explorer/Explorer';
import { canBoot, type Phase } from '@/hooks/useVirtualMachine';
import { baseName } from '@/lib/paths';
import { useWorkspace } from './context';

export const PANEL = {
  explorer: 'explorer',
  terminal: 'terminal',
  welcome: 'welcome',
  file: 'file',
} as const;

/**
 * Whether a tab can be closed. The Explorer and the Terminal are fixtures of
 * the workspace: they can be moved, but not closed. Welcome stays open until
 * Linux has booted.
 */
export function canClose(component: string, phase: Phase): boolean {
  if (component === PANEL.explorer || component === PANEL.terminal)
    return false;
  return !(component === PANEL.welcome && canBoot(phase));
}

export interface FilePanelParams {
  path: string;
}

/** The file a panel shows, following it when the file is moved. */
function usePanelPath(api: DockviewPanelApi, initial: string): string {
  const [path, setPath] = useState(initial);
  useEffect(() => {
    const subscription = api.onDidParametersChange((params) => {
      if (typeof params.path === 'string') setPath(params.path);
    });
    return () => subscription.dispose();
  }, [api]);
  return path;
}

function useTitle(api: DockviewPanelApi): string {
  const subscribe = useCallback(
    (notify: () => void) => {
      const subscription = api.onDidTitleChange(notify);
      return () => subscription.dispose();
    },
    [api],
  );
  return useSyncExternalStore(subscribe, () => api.title ?? '');
}

function BootPrompt({ compact = false }: { compact?: boolean }) {
  const { vm, boot } = useWorkspace();
  const failed = vm.phase === 'error';
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <TerminalIcon />
        </EmptyMedia>
        <EmptyTitle>
          {failed ? 'Linux failed to boot' : 'Linux is not running'}
        </EmptyTitle>
        <EmptyDescription>
          {failed
            ? `${vm.error ?? 'Something went wrong.'} Boot again to retry.`
            : compact
              ? 'Boot Linux to browse and edit the files in /root/playground.'
              : 'Boot and start a Linux shell in the terminal. The first boot may take longer as the image is being downloaded and unpacked.'}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button
          id={compact ? undefined : 'boot'}
          onClick={boot}
          type="button"
          size={compact ? 'default' : 'lg'}
          className="w-32"
        >
          Boot
        </Button>
      </EmptyContent>
    </Empty>
  );
}

export function ExplorerPanel() {
  const { vm, filesReady, openFile, movePath, deletePath } = useWorkspace();

  if (filesReady) {
    return (
      <Explorer
        fs={vm.files}
        onOpenFile={openFile}
        onMove={movePath}
        onDelete={deletePath}
      />
    );
  }

  let body;
  if (canBoot(vm.phase)) {
    body = <BootPrompt compact />;
  } else if (vm.phase === 'downloading' || vm.phase === 'booting') {
    body = (
      <Empty>
        <EmptyHeader>
          <EmptyMedia>
            <Spinner />
          </EmptyMedia>
          <EmptyDescription>Starting Linux…</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  } else {
    body = (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Files are not available</EmptyTitle>
          <EmptyDescription>
            Linux could not mount /root/playground from the browser, so its
            files can only be reached from the terminal in this session.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return <div className="flex h-full bg-background">{body}</div>;
}

export function TerminalPanel() {
  const { vm, terminal } = useWorkspace();
  return (
    <div className="terminal-surface relative h-full">
      <TerminalView session={terminal} />
      {vm.phase === 'downloading' ? (
        <Progress
          aria-label="Linux download progress"
          className="absolute inset-x-0 top-0 z-10 w-full gap-0 **:data-[slot=progress-indicator]:bg-foreground **:data-[slot=progress-track]:rounded-none"
          value={vm.progress ?? 0}
        />
      ) : null}
      {canBoot(vm.phase) ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center overflow-auto bg-terminal">
          <BootPrompt />
        </div>
      ) : null}
    </div>
  );
}

export function WelcomePanel() {
  const { vm, boot } = useWorkspace();
  return (
    <div className="h-full overflow-auto bg-background">
      <div className="mx-auto flex min-h-full max-w-2xl flex-col gap-6 px-8 py-10 text-sm">
        <header className="flex flex-col gap-2">
          <h2 className="font-heading text-2xl font-medium tracking-tight">
            Mininet Web Playground
          </h2>
          <p className="text-muted-foreground">
            <a
              href="https://mininet.org/"
              target="_blank"
              rel="noopener noreferrer"
              className="link-dashed"
            >
              Mininet
            </a>{' '}
            is great for learning network topologies and experimenting with
            software defined network (SDN) prototypes. Here everything runs
            locally in the browser via a{' '}
            <a
              href="https://copy.sh/v86/"
              target="_blank"
              rel="noopener noreferrer"
              className="link-dashed"
            >
              v86
            </a>{' '}
            Linux emulation, so you can get started immediately with no
            installation required. I hope this can be a helpful resource and
            reduces the barrier for people to learn about networks and SDN :)
          </p>
        </header>

        <section className="flex flex-col gap-4">
          <h3 className="font-medium">Get started</h3>
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-muted-foreground marker:text-foreground">
            <li>
              Boot Linux. The terminal opens a shell in{' '}
              <code className="welcome-code">/root/playground</code>.
            </li>
            <li>
              Pick a file in the Explorer to edit it here, such as{' '}
              <code className="welcome-code">lab.py</code>. Save with{' '}
              <kbd className="welcome-code">Ctrl/⌘ S</kbd>.
            </li>
            <li>
              Run <code className="welcome-code">python3 lab.py</code> in the
              terminal, then try <code className="welcome-code">pingall</code>{' '}
              in the Mininet CLI.
            </li>
          </ol>
          {canBoot(vm.phase) ? (
            <div>
              <Button
                onClick={boot}
                type="button"
                className="mt-4 w-32"
                size="lg"
              >
                Boot
              </Button>
            </div>
          ) : null}
        </section>
        <div className="mt-auto pt-6">
          <Credits />
        </div>
      </div>
    </div>
  );
}

function FileMessage({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full bg-background">
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{body}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}

export function FilePanel(props: IDockviewPanelProps<FilePanelParams>) {
  const { documents } = useWorkspace();
  const path = usePanelPath(props.api, props.params.path);
  const doc = useSyncExternalStore(documents.subscribe, () =>
    documents.getSnapshot(path),
  );
  const name = baseName(path);

  switch (doc.status) {
    case 'waiting':
      return (
        <FileMessage
          title={name}
          body="This file loads once Linux is running."
        />
      );
    case 'loading':
      return (
        <div className="flex h-full items-center justify-center bg-background">
          <Spinner />
        </div>
      );
    case 'missing':
      return (
        <FileMessage
          title={`${name} was not found`}
          body={`/root/playground/${path} no longer exists. It may have been moved or deleted.`}
        />
      );
    case 'too-large':
      return (
        <FileMessage
          title={`${name} is too large to edit here`}
          body={`Files over ${MAX_EDITABLE_BYTES / (1024 * 1024)} MB are not opened in the editor. Use the terminal to work with it.`}
        />
      );
    case 'binary':
      return (
        <FileMessage
          title={`${name} is not a text file`}
          body="The editor only opens UTF-8 text. Use the terminal to work with it."
        />
      );
    case 'error':
      return (
        <FileMessage
          title={`${name} could not be opened`}
          body={doc.error ?? 'The file operation failed.'}
        />
      );
    case 'ready':
      break;
    default: {
      const exhaustive: never = doc.status;
      return exhaustive;
    }
  }
  if (!doc.model) return null;

  const notice =
    doc.saveError ??
    (doc.deletedOnDisk
      ? `${name} was deleted or moved. Saving will create it again.`
      : null);
  return (
    <div className="flex h-full flex-col bg-background">
      {notice ? (
        <div
          role="alert"
          className="shrink-0 border-b bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
        >
          {notice}
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1">
        <CodeEditor
          model={doc.model}
          onSave={() => void documents.save(path)}
        />
      </div>
    </div>
  );
}

function tabIcon(component: string) {
  switch (component) {
    case PANEL.explorer:
      return FolderTreeIcon;
    case PANEL.terminal:
      return TerminalIcon;
    default:
      return SparklesIcon;
  }
}

export function PanelTab(props: IDockviewPanelHeaderProps) {
  const { documents, closeTabs, vm } = useWorkspace();
  const { api } = props;
  const isFile = api.component === PANEL.file;
  const title = useTitle(api);
  const path = usePanelPath(
    api,
    typeof props.params?.path === 'string' ? props.params.path : '',
  );
  const doc = useSyncExternalStore(documents.subscribe, () =>
    isFile ? documents.getSnapshot(path) : null,
  );
  const Icon = tabIcon(api.component);
  const dirty = doc?.dirty ?? false;

  const closable = canClose(api.component, vm.phase);
  const locked = api.component === PANEL.welcome && !closable;

  const close = () => closeTabs([api.id]);

  return (
    <div
      className="dock-tab"
      title={isFile ? `/root/playground/${path}` : undefined}
      onAuxClick={(event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        close();
      }}
      onDoubleClick={() => {
        if (locked && api.isMaximized()) return;
        if (api.isMaximized()) api.exitMaximized();
        else api.maximize();
      }}
    >
      {isFile ? (
        <FileTypeIcon name={baseName(path)} className="size-3.5 shrink-0" />
      ) : (
        <Icon aria-hidden className="size-3.5 shrink-0 opacity-70" />
      )}
      <span
        className={
          doc?.deletedOnDisk || doc?.status === 'missing'
            ? 'truncate line-through'
            : 'truncate'
        }
      >
        {title}
      </span>
      {closable ? (
        <button
          type="button"
          className="dock-tab-close"
          data-dirty={dirty || undefined}
          aria-label={
            dirty ? `Close ${title} (unsaved changes)` : `Close ${title}`
          }
          onPointerDown={(event) => event.preventDefault()}
          onDoubleClick={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            close();
          }}
        >
          <span aria-hidden className="dock-tab-dot" />
          <XIcon aria-hidden className="size-3" />
        </button>
      ) : null}
    </div>
  );
}

/** The maximize toggle at the right of every pane's tab strip. */
export function PaneActions(props: IDockviewHeaderActionsProps) {
  const { vm } = useWorkspace();
  const { api, containerApi, panels } = props;
  const subscribe = useCallback(
    (notify: () => void) => {
      const subscription = containerApi.onDidMaximizedGroupChange(notify);
      return () => subscription.dispose();
    },
    [containerApi],
  );
  const maximized = useSyncExternalStore(subscribe, () => api.isMaximized());

  const label = maximized ? 'Restore pane' : 'Maximize pane';
  const coverLocked =
    maximized &&
    canBoot(vm.phase) &&
    panels.some((panel) => panel.api.component === PANEL.welcome);
  if (coverLocked) return null;
  return (
    <div className="flex h-full items-center pr-1">
      <Button
        aria-label={label}
        title={label}
        size="icon-xs"
        variant="ghost"
        onClick={() => {
          if (maximized) api.exitMaximized();
          else api.maximize();
        }}
      >
        {maximized ? <Minimize2Icon /> : <Maximize2Icon />}
      </Button>
    </div>
  );
}

export function Watermark() {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
      Nothing is open. Use the View menu to bring a panel back.
    </div>
  );
}
