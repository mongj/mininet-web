import {
  DockviewReact,
  type AddPanelOptions,
  type AddPanelPositionOptions,
  type DockviewApi,
  type DockviewReadyEvent,
  type DockviewTheme,
  type IDockviewPanel,
} from 'dockview-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { TerminalSession } from '@/components/Terminal';
import { useResolvedAppearance } from '@/components/theme-provider';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DocumentStore } from '@/editor/documents';
import {
  canBoot,
  isBooted,
  type useVirtualMachine,
} from '@/hooks/useVirtualMachine';
import { baseName, isPathWithin, rebasePath } from '@/lib/paths';
import { WorkspaceContext, type WorkspaceValue } from './context';
import {
  ExplorerPanel,
  FilePanel,
  canClose,
  PANEL,
  PaneActions,
  PanelTab,
  TerminalPanel,
  Watermark,
  WelcomePanel,
  type FilePanelParams,
} from './panels';

const LAYOUT_KEY = 'mininet-web:layout:v1';
const BOOTED_KEY = 'mininet-web:booted';
const LAYOUT_SAVE_MS = 300;
const EXPLORER_WIDTH = 240;
const TERMINAL_HEIGHT = 280;

const components = {
  [PANEL.explorer]: ExplorerPanel,
  [PANEL.terminal]: TerminalPanel,
  [PANEL.welcome]: WelcomePanel,
  [PANEL.file]: FilePanel,
};

const TITLES = {
  [PANEL.explorer]: 'Explorer',
  [PANEL.terminal]: 'Terminal',
  [PANEL.welcome]: 'Welcome',
} as const;

function filePath(panel: IDockviewPanel): string | null {
  if (panel.view.contentComponent !== PANEL.file) return null;
  const path = (panel.params as Partial<FilePanelParams> | undefined)?.path;
  return typeof path === 'string' ? path : null;
}

/** Panels that belong in the main editing area. */
function isEditorPanel(panel: IDockviewPanel): boolean {
  const component = panel.view.contentComponent;
  return component === PANEL.file || component === PANEL.welcome;
}

function addExplorer(api: DockviewApi): void {
  api.addPanel({
    id: PANEL.explorer,
    component: PANEL.explorer,
    title: TITLES.explorer,
    position: { direction: 'left' },
    initialWidth: EXPLORER_WIDTH,
    minimumWidth: 160,
  });
}

function addTerminal(api: DockviewApi): void {
  api.addPanel({
    id: PANEL.terminal,
    component: PANEL.terminal,
    title: TITLES.terminal,
    position: { direction: 'below' },
    initialHeight: TERMINAL_HEIGHT,
    minimumHeight: 80,
  });
}

function addWelcome(
  api: DockviewApi,
  position?: AddPanelPositionOptions,
): void {
  api.addPanel({
    id: PANEL.welcome,
    component: PANEL.welcome,
    title: TITLES.welcome,
    position,
  });
}

function addFilePanel(
  api: DockviewApi,
  path: string,
  options: Pick<AddPanelOptions, 'position' | 'inactive'>,
): void {
  api.addPanel<FilePanelParams>({
    id: `file:${crypto.randomUUID()}`,
    component: PANEL.file,
    title: baseName(path),
    params: { path },
    ...options,
  });
}

function addDefaultPanels(api: DockviewApi): void {
  addWelcome(api);
  addTerminal(api);
  addExplorer(api);
  api.getPanel(PANEL.welcome)?.api.setActive();
}

/**
 * The Explorer and the Terminal cannot be closed, so a layout saved without
 * one of them (by an earlier version) gets it back.
 */
function addMissingFixtures(api: DockviewApi): void {
  if (!api.getPanel(PANEL.terminal)) addTerminal(api);
  if (!api.getPanel(PANEL.explorer)) addExplorer(api);
}

function hasBootedBefore(): boolean {
  try {
    return localStorage.getItem(BOOTED_KEY) === '1';
  } catch (error) {
    console.error(error);
    return false;
  }
}

function rememberBooted(): void {
  try {
    localStorage.setItem(BOOTED_KEY, '1');
  } catch (error) {
    console.error(error);
  }
}

function restoreLayout(api: DockviewApi): boolean {
  try {
    const saved = localStorage.getItem(LAYOUT_KEY);
    if (!saved) return false;
    api.fromJSON(JSON.parse(saved));
    return api.totalPanels > 0;
  } catch (error) {
    console.error(error);
    api.clear();
    return false;
  }
}

interface WorkspaceProps {
  vm: ReturnType<typeof useVirtualMachine>;
  terminal: TerminalSession;
  boot: () => void;
  /** Rendered above the dock, inside the workspace context. */
  children: ReactNode;
}

interface PendingClose {
  panelIds: string[];
  dirtyPaths: string[];
}

export function Workspace({ vm, terminal, boot, children }: WorkspaceProps) {
  const dock = useRef<DockviewApi | null>(null);
  // Each page load starts with Linux stopped. Welcome stays maximized until
  // the first successful boot; later visits start Linux with the panes visible.
  const [bootedBefore] = useState(hasBootedBefore);
  const coverUntilBoot = useRef(vm.phase === 'idle' && !bootedBefore);
  const autoBoot = useRef(bootedBefore);
  // The file each open file panel shows, mirrored into the document store.
  const panelPaths = useRef(new Map<string, string>());
  const lastEditorGroup = useRef<string | null>(null);
  const documents = useMemo(() => new DocumentStore(vm.files), [vm.files]);
  const [pendingClose, setPendingClose] = useState<PendingClose | null>(null);
  const appearance = useResolvedAppearance();

  const booted = isBooted(vm.phase);
  const filesReady =
    booted &&
    !(vm.storage?.persistent === false && vm.storage.reason === 'mount-failed');

  useEffect(() => {
    documents.setReady(filesReady);
  }, [documents, filesReady]);

  useEffect(
    () => vm.files.onChange((change) => documents.handleChange(change)),
    [documents, vm.files],
  );

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (documents.hasUnsavedChanges()) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [documents]);

  // After the terminal is mounted. Once per load; a later error does not retry.
  useEffect(() => {
    if (!autoBoot.current || vm.phase !== 'idle') {
      autoBoot.current = false;
      return;
    }
    const id = setTimeout(() => {
      autoBoot.current = false;
      boot();
    }, 0);
    return () => clearTimeout(id);
  }, [boot, vm.phase]);

  useEffect(() => {
    if (booted) rememberBooted();
  }, [booted]);

  /** Opens and closes documents so they match the file panels in the dock. */
  const syncDocuments = useCallback(() => {
    const current = new Map<string, string>();
    for (const panel of dock.current?.panels ?? []) {
      const path = filePath(panel);
      if (path !== null) current.set(panel.id, path);
    }
    const previous = panelPaths.current;
    // Open before closing, so a document that only changed panels survives.
    for (const [id, path] of current) {
      if (previous.get(id) !== path) documents.open(path);
    }
    for (const [id, path] of previous) {
      if (current.get(id) !== path) documents.close(path);
    }
    panelPaths.current = current;
  }, [documents]);

  /** Where a new editor tab goes: beside the editors already open. */
  const editorPosition = useCallback(():
    AddPanelPositionOptions | undefined => {
    const api = dock.current;
    if (!api) return undefined;
    const last = api.groups.find(
      (group) => group.id === lastEditorGroup.current,
    );
    const group =
      last ?? api.groups.find((each) => each.panels.some(isEditorPanel));
    if (group) return { referenceGroup: group };
    if (api.getPanel(PANEL.terminal)) {
      return { referencePanel: PANEL.terminal, direction: 'above' };
    }
    if (api.getPanel(PANEL.explorer)) {
      return { referencePanel: PANEL.explorer, direction: 'right' };
    }
    return undefined;
  }, []);

  const showWelcome = useCallback(() => {
    const api = dock.current;
    if (!api) return;
    const existing = api.getPanel(PANEL.welcome);
    if (existing) existing.api.setActive();
    else addWelcome(api, editorPosition());
  }, [editorPosition]);

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      const api = event.api;
      dock.current = api;
      if (restoreLayout(api)) addMissingFixtures(api);
      else addDefaultPanels(api);
      syncDocuments();

      api.onDidAddPanel(syncDocuments);
      api.onDidRemovePanel(syncDocuments);
      api.onDidActivePanelChange(() => {
        const panel = api.activePanel;
        if (panel && isEditorPanel(panel)) {
          lastEditorGroup.current = panel.group.id;
        }
      });
      if (coverUntilBoot.current) {
        showWelcome();
        api.getPanel(PANEL.welcome)?.api.maximize();
      }
      let saveTimer: ReturnType<typeof setTimeout> | undefined;
      api.onDidLayoutChange(() => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          if (dock.current !== api) return;
          try {
            localStorage.setItem(LAYOUT_KEY, JSON.stringify(api.toJSON()));
          } catch (error) {
            console.error(error);
          }
        }, LAYOUT_SAVE_MS);
      });
      if (!coverUntilBoot.current) {
        api.getPanel(PANEL.welcome)?.api.exitMaximized();
      }
    },
    [showWelcome, syncDocuments],
  );

  const openFile = useCallback(
    (path: string) => {
      const api = dock.current;
      if (!api) return;
      const existing = api.panels.find((panel) => filePath(panel) === path);
      if (existing) {
        existing.api.setActive();
        return;
      }
      addFilePanel(api, path, { position: editorPosition() });
    },
    [editorPosition],
  );

  const movePath = useCallback(
    async (from: string, to: string) => {
      await vm.files.rename(from, to);
      documents.rename(from, to);
      for (const panel of dock.current?.panels ?? []) {
        const path = filePath(panel);
        if (path === null || !isPathWithin(from, path)) continue;
        const next = rebasePath(path, from, to);
        panelPaths.current.set(panel.id, next);
        panel.api.updateParameters({ path: next } satisfies FilePanelParams);
        panel.api.setTitle(baseName(next));
      }
    },
    [documents, vm.files],
  );

  const deletePath = useCallback(
    async (path: string) => {
      await vm.files.remove(path);
      for (const panel of [...(dock.current?.panels ?? [])]) {
        const open = filePath(panel);
        if (open !== null && isPathWithin(path, open)) panel.api.close();
      }
    },
    [vm.files],
  );

  const closePanels = useCallback((panelIds: string[]) => {
    for (const id of panelIds) dock.current?.getPanel(id)?.api.close();
  }, []);

  const closeTabs = useCallback(
    (panelIds: string[]) => {
      const fileIds: string[] = [];
      const dirtyPaths: string[] = [];
      for (const id of panelIds) {
        const panel = dock.current?.getPanel(id);
        if (!panel || !canClose(panel.view.contentComponent, vm.phase)) {
          continue;
        }
        const path = filePath(panel);
        if (path === null) {
          panel.api.close();
          continue;
        }
        fileIds.push(id);
        if (documents.getSnapshot(path).dirty) dirtyPaths.push(path);
      }
      if (dirtyPaths.length === 0) closePanels(fileIds);
      else setPendingClose({ panelIds: fileIds, dirtyPaths });
    },
    [closePanels, documents, vm.phase],
  );

  async function saveAndClose(pending: PendingClose) {
    setPendingClose(null);
    await Promise.all(pending.dirtyPaths.map((path) => documents.save(path)));
    // A file whose save failed stays open, showing why.
    closePanels(
      pending.panelIds.filter((id) => {
        const path = panelPaths.current.get(id);
        return path === undefined || !documents.getSnapshot(path).dirty;
      }),
    );
  }

  const bootAndReveal = useCallback(() => {
    if (coverUntilBoot.current) {
      coverUntilBoot.current = false;
      dock.current?.getPanel(PANEL.welcome)?.api.exitMaximized();
    }
    boot();
  }, [boot]);

  const resetLayout = useCallback(() => {
    const api = dock.current;
    if (!api) return;
    const open = [...panelPaths.current.values()];
    // Hold the documents across the rebuild so unsaved edits are kept.
    for (const path of open) documents.open(path);
    api.clear();
    lastEditorGroup.current = null;
    addDefaultPanels(api);
    if (coverUntilBoot.current) api.getPanel(PANEL.welcome)?.api.maximize();
    for (const path of open) {
      addFilePanel(api, path, {
        position: { referencePanel: PANEL.welcome },
        inactive: true,
      });
    }
    syncDocuments();
    for (const path of open) documents.close(path);
  }, [documents, syncDocuments]);

  const value = useMemo<WorkspaceValue>(
    () => ({
      vm,
      filesReady,
      terminal,
      documents,
      boot: bootAndReveal,
      openFile,
      movePath,
      deletePath,
      closeTabs,
      showWelcome,
      resetLayout,
    }),
    [
      vm,
      filesReady,
      terminal,
      documents,
      bootAndReveal,
      openFile,
      movePath,
      deletePath,
      closeTabs,
      showWelcome,
      resetLayout,
    ],
  );

  const theme = useMemo<DockviewTheme>(
    () => ({
      name: 'mininet',
      className: 'dockview-theme-light dockview-spaced mininet-dock',
      colorScheme: appearance,
      gap: 6,
      dndOverlayMounting: 'absolute',
      dndPanelOverlay: 'group',
      dndTabIndicator: 'line',
    }),
    [appearance],
  );

  const dirtyCount = pendingClose?.dirtyPaths.length ?? 0;
  return (
    <WorkspaceContext.Provider value={value}>
      {children}
      <div className="relative min-h-0 flex-1">
        <DockviewReact
          className="absolute inset-0"
          components={components}
          defaultTabComponent={PanelTab}
          rightHeaderActionsComponent={PaneActions}
          watermarkComponent={Watermark}
          defaultRenderer="always"
          theme={theme}
          getTabContextMenuItems={({ panel, group }) => {
            const closable = (each: IDockviewPanel) =>
              canClose(each.view.contentComponent, vm.phase);
            const close = (panels: IDockviewPanel[]) =>
              closeTabs(panels.map((each) => each.id));
            const welcomeLocked =
              panel.view.contentComponent === PANEL.welcome &&
              canBoot(vm.phase);
            const others = group.panels.filter(
              (each) => each !== panel && closable(each),
            );
            const all = group.panels.filter(closable);
            return [
              {
                label: 'Close',
                action: () => close([panel]),
                disabled: !closable(panel),
              },
              {
                label: 'Close Others',
                action: () => close(others),
                disabled: others.length === 0,
              },
              {
                label: 'Close All',
                action: () => close(all),
                disabled: all.length === 0,
              },
              'separator',
              welcomeLocked
                ? {
                    label: panel.api.isMaximized() ? 'Restore' : 'Maximize',
                    disabled: true,
                  }
                : 'maximize',
              'float',
            ];
          }}
          onReady={onReady}
        />
      </div>

      <Dialog
        open={pendingClose !== null}
        onOpenChange={(open) => {
          if (!open) setPendingClose(null);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>
              {dirtyCount === 1
                ? `Save changes to ${baseName(pendingClose?.dirtyPaths[0] ?? '')}?`
                : `Save changes to ${dirtyCount} files?`}
            </DialogTitle>
            <DialogDescription>
              Your changes will be lost if you close without saving.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingClose(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingClose) closePanels(pendingClose.panelIds);
                setPendingClose(null);
              }}
            >
              Don't Save
            </Button>
            <Button
              onClick={() => {
                if (pendingClose) void saveAndClose(pendingClose);
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </WorkspaceContext.Provider>
  );
}
