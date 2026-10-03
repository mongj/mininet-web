import {
  asyncDataLoaderFeature,
  dragAndDropFeature,
  hotkeysCoreFeature,
  keyboardDragAndDropFeature,
  renamingFeature,
  selectionFeature,
  type ItemInstance,
} from '@headless-tree/core';
import { AssistiveTreeDescription, useTree } from '@headless-tree/react';
import {
  CopyMinusIcon,
  FileIcon,
  FilePlusIcon,
  FolderIcon,
  FolderPlusIcon,
  RefreshCwIcon,
  XIcon,
} from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ExplorerRow } from '@/explorer/ExplorerRow';
import { toItems, type ExplorerItem } from '@/explorer/items';
import {
  childrenCache,
  idOf,
  isGone,
  livePaths,
  parentId,
  pathOf,
  ROOT_ID,
  useTreeRefresh,
} from '@/explorer/tree';
import { useVisibleRows } from '@/explorer/useVisibleRows';
import { errorMessage } from '@/lib/errors';
import {
  baseName,
  isPathWithin,
  joinPath,
  nameProblem,
  parentPath,
  rebasePath,
} from '@/lib/paths';
import type { FileSystemClient } from '@/vm/fs-client';

const ROW_HEIGHT = 22;
const INDENT = 8;
const ROW_PADDING = 8;
const OVERSCAN = 8;

const ROOT_ITEM: ExplorerItem = { path: '', name: 'playground', kind: 'dir' };
const LOADING_ITEM: ExplorerItem = { path: '', name: '', kind: 'file' };

// Survives the Explorer panel being closed and reopened.
let rememberedExpanded: string[] = [];

interface Creating {
  parent: string;
  kind: 'file' | 'dir';
}

export interface ExplorerProps {
  fs: FileSystemClient;
  onOpenFile: (path: string) => void;
  /** Moves a file or folder; rejects with a user-facing `Error` on failure. */
  onMove: (from: string, to: string) => Promise<void>;
  /** Deletes a file or folder; rejects with a user-facing `Error` on failure. */
  onDelete: (path: string) => Promise<void>;
}

export function Explorer({ fs, onOpenFile, onMove, onDelete }: ExplorerProps) {
  const [creating, setCreating] = useState<Creating | null>(null);
  const [menuTarget, setMenuTarget] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const renameSelected = useRef<string | null>(null);

  async function loadChildren(id: string) {
    const dir = pathOf(id);
    try {
      const items = toItems(dir, await fs.list(dir));
      return items.map((data) => ({ id: idOf(data.path), data }));
    } catch {
      // The folder is gone, or Linux stopped; either way it has no entries.
      return [];
    }
  }

  const tree = useTree<ExplorerItem>({
    rootItemId: ROOT_ID,
    initialState: { expandedItems: rememberedExpanded },
    indent: INDENT,
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => item.getItemData().kind === 'dir',
    createLoadingItemData: () => LOADING_ITEM,
    dataLoader: {
      getItem: async (id) => {
        if (id === ROOT_ID) return ROOT_ITEM;
        const siblings = await loadChildren(parentId(id));
        return (
          siblings.find((sibling) => sibling.id === id)?.data ?? {
            path: pathOf(id),
            name: baseName(pathOf(id)),
            kind: 'file',
          }
        );
      },
      getChildrenWithData: loadChildren,
    },
    scrollToItem: (item) => {
      const element = scroller.current;
      const index = item?.getItemMeta().index ?? -1;
      if (!element || index < 0) return;
      const top = index * ROW_HEIGHT;
      if (top < element.scrollTop) element.scrollTop = top;
      else if (top + ROW_HEIGHT > element.scrollTop + element.clientHeight) {
        element.scrollTop = top + ROW_HEIGHT - element.clientHeight;
      }
    },
    canReorder: false,
    canDrop: (items, target) =>
      target.item.isFolder() &&
      pathsToMove(items, pathOf(target.item.getId())).length > 0,
    onDrop: async (items, target) => {
      const destination = pathOf(target.item.getId());
      const moved: string[] = [];
      for (const path of pathsToMove(items, destination)) {
        const to = joinPath(destination, baseName(path));
        if (await move(path, to)) moved.push(to);
      }
      if (target.item.getId() !== ROOT_ID && !target.item.isExpanded()) {
        target.item.expand();
      }
      await settled();
      if (moved.length > 0) reveal(moved);
    },
    canRename: (item) => item.getId() !== ROOT_ID,
    onRename: (item, value) => {
      const from = pathOf(item.getId());
      const name = value.trim();
      if (name === baseName(from)) return;
      const problem = nameProblem(name);
      if (problem) {
        setError(problem);
        return;
      }
      const to = joinPath(parentPath(from), name);
      void move(from, to).then(async (ok) => {
        if (!ok) return;
        await settled();
        reveal([to]);
      });
    },
    hotkeys: {
      // Keep the browser from also scrolling the tree for these keys. An
      // override replaces the preset's key during matching, so restate it.
      focusFirstItem: { hotkey: 'Home', preventDefault: true },
      focusLastItem: { hotkey: 'End', preventDefault: true },
      expandOrDown: { hotkey: 'ArrowRight', preventDefault: true },
      collapseOrUp: { hotkey: 'ArrowLeft', preventDefault: true },
      selectUpwards: { hotkey: 'Shift+ArrowUp', preventDefault: true },
      selectDownwards: { hotkey: 'Shift+ArrowDown', preventDefault: true },
      selectAll: { hotkey: 'metaorcontrol+KeyA' },
      customOpen: {
        hotkey: 'Enter',
        isEnabled: (instance) => !instance.isRenamingItem(),
        handler: (_event, instance) => {
          const item = instance.getFocusedItem();
          if (!item) return;
          if (item.isFolder()) {
            if (item.isExpanded()) item.collapse();
            else item.expand();
          } else activate(item);
        },
      },
      customDelete: {
        hotkey: 'Delete',
        handler: () => requestDelete(),
      },
      customDeleteMac: {
        hotkey: 'metaorcontrol+Backspace',
        handler: () => requestDelete(),
      },
    },
    features: [
      asyncDataLoaderFeature,
      selectionFeature,
      hotkeysCoreFeature,
      dragAndDropFeature,
      keyboardDragAndDropFeature,
      renamingFeature,
    ],
  });
  const { refreshAll, settled } = useTreeRefresh(tree, fs);
  const visible = useVisibleRows(ROW_HEIGHT, OVERSCAN);
  const scroller = visible.scroller;

  const expandedItems = tree.getState().expandedItems;
  useEffect(() => {
    rememberedExpanded = expandedItems;
  }, [expandedItems]);

  const renamingItem = tree.getState().renamingItem;
  useEffect(() => {
    if (!renamingItem) renameSelected.current = null;
  }, [renamingItem]);

  /** The entries among `items` that dropping on `destination` would move. */
  function pathsToMove(
    items: ItemInstance<ExplorerItem>[],
    destination: string,
  ): string[] {
    return livePaths(
      tree,
      items.map((item) => item.getId()),
    ).filter((path) => parentPath(path) !== destination);
  }

  /** Moves one entry; false, with the reason shown, when it could not be. */
  async function move(from: string, to: string): Promise<boolean> {
    try {
      await onMove(from, to);
    } catch (error) {
      setError(`Could not move ${baseName(from)}. ${errorMessage(error)}`);
      return false;
    }
    setError(null);
    // Keep moved folders open, under their new ids.
    tree.applySubStateUpdate('expandedItems', (ids) =>
      ids.map((id) =>
        isPathWithin(from, pathOf(id))
          ? idOf(rebasePath(pathOf(id), from, to))
          : id,
      ),
    );
    return true;
  }

  /** Selects `paths` and moves focus to the first of them. */
  function reveal(paths: string[]) {
    const ids = paths.map(idOf).filter((id) => !isGone(tree, id));
    if (ids.length === 0) return;
    tree.setSelectedItems(ids);
    tree.getItemInstance(ids[0]).setFocused();
    tree.updateDomFocus();
  }

  function activate(item: ItemInstance<ExplorerItem>) {
    const data = item.getItemData();
    if (data.kind === 'file') onOpenFile(data.path);
  }

  /** The folder a new entry goes into: the given one, or the one around it. */
  function containerOf(id: string | null): string {
    if (id === null || id === ROOT_ID || isGone(tree, id)) return ROOT_ID;
    return tree.getItemInstance(id).isFolder() ? id : parentId(id);
  }

  /** Starts naming a new entry beside `near`, or beside the selection. */
  function startCreating(
    kind: Creating['kind'],
    near: string | null = tree.getState().selectedItems.at(-1) ?? null,
  ) {
    const parent = containerOf(near);
    if (parent !== ROOT_ID) {
      const item = tree.getItemInstance(parent);
      if (!item.isExpanded()) item.expand();
    }
    setError(null);
    setCreating({ parent, kind });
  }

  async function commitCreating(value: string): Promise<boolean> {
    if (!creating) return true;
    const name = value.trim();
    const problem = nameProblem(name);
    if (problem) {
      setError(problem);
      return false;
    }
    const path = joinPath(pathOf(creating.parent), name);
    try {
      if (creating.kind === 'dir') await fs.createDir(path);
      else await fs.createFile(path);
    } catch (error) {
      setError(`Could not create ${name}. ${errorMessage(error)}`);
      return false;
    }
    setError(null);
    setCreating(null);
    await settled();
    reveal([path]);
    if (creating.kind === 'file') onOpenFile(path);
    return true;
  }

  /** What an action applies to: the selection, or just `id` when outside it. */
  function targetsOf(id: string | null): string[] {
    const selected = tree.getState().selectedItems;
    const ids = id !== null && !selected.includes(id) ? [id] : selected;
    return livePaths(tree, ids);
  }

  function requestDelete(id: string | null = null) {
    const paths = targetsOf(id);
    if (paths.length > 0) setPendingDelete(paths);
  }

  async function confirmDelete() {
    const paths = pendingDelete ?? [];
    setPendingDelete(null);
    const failures: string[] = [];
    for (const path of paths) {
      try {
        await onDelete(path);
      } catch (error) {
        failures.push(`${baseName(path)}: ${errorMessage(error)}`);
      }
    }
    setError(
      failures.length > 0 ? `Could not delete ${failures.join(' ')}` : null,
    );
    await settled();
    // With no rows left there is nothing to hand focus to.
    if (tree.getItems().length > 0) tree.updateDomFocus();
  }

  const items = tree.getItems();
  // The row index the new-entry input sits at, right under its parent folder.
  let creatingIndex = -1;
  let creatingLevel = 0;
  if (creating) {
    if (creating.parent === ROOT_ID) creatingIndex = 0;
    else {
      const parent = items.find((item) => item.getId() === creating.parent);
      if (parent) {
        creatingIndex = parent.getItemMeta().index + 1;
        creatingLevel = parent.getItemMeta().level + 1;
      }
    }
  }
  const rowCount = items.length + (creatingIndex >= 0 ? 1 : 0);

  const renderRow = (row: number): ReactNode => {
    if (row === creatingIndex && creating) {
      return (
        <div
          key="creating"
          className="explorer-row"
          style={{
            top: row * ROW_HEIGHT,
            paddingLeft: ROW_PADDING + creatingLevel * INDENT,
          }}
        >
          <span className="explorer-twistie" />
          {creating.kind === 'dir' ? (
            <FolderIcon className="explorer-icon" />
          ) : (
            <FileIcon className="explorer-icon" />
          )}
          <NameInput
            label={
              creating.kind === 'dir' ? 'New folder name' : 'New file name'
            }
            onCommit={commitCreating}
            onCancel={() => setCreating(null)}
          />
        </div>
      );
    }
    const item =
      items[creatingIndex >= 0 && row > creatingIndex ? row - 1 : row];
    if (!item) return null;
    return (
      <ExplorerRow
        key={item.getId()}
        item={item}
        style={{
          top: row * ROW_HEIGHT,
          paddingLeft: ROW_PADDING + item.getItemMeta().level * INDENT,
        }}
        renameSelected={renameSelected}
        onActivate={activate}
        onContextMenu={setMenuTarget}
      />
    );
  };

  const rows: ReactNode[] = [];
  const first = visible.first;
  const end = Math.min(visible.last, rowCount);
  for (let row = first; row < end; row++) rows.push(renderRow(row));
  // Keep the focused row mounted when it is scrolled out of view, so that
  // scrolling does not drop keyboard focus.
  const focusedId = tree.getState().focusedItem;
  const focusedIndex =
    focusedId === null
      ? -1
      : (items.find((item) => item.getId() === focusedId)?.getItemMeta()
          .index ?? -1);
  if (focusedIndex >= 0) {
    const row =
      creatingIndex >= 0 && focusedIndex >= creatingIndex
        ? focusedIndex + 1
        : focusedIndex;
    if (row < first || row >= end) rows.push(renderRow(row));
  }

  const menuTargets = menuTarget === null ? [] : targetsOf(menuTarget);
  const rootLoaded = childrenCache(tree)?.[ROOT_ID] !== undefined;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-[13px]">
      <div className="flex h-8 shrink-0 items-center gap-0.5 pr-1 pl-3">
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          playground
        </span>
        <ToolbarButton label="New File" onClick={() => startCreating('file')}>
          <FilePlusIcon />
        </ToolbarButton>
        <ToolbarButton label="New Folder" onClick={() => startCreating('dir')}>
          <FolderPlusIcon />
        </ToolbarButton>
        <ToolbarButton label="Refresh" onClick={() => void refreshAll()}>
          <RefreshCwIcon />
        </ToolbarButton>
        <ToolbarButton
          label="Collapse Folders"
          onClick={() => {
            tree.applySubStateUpdate('expandedItems', []);
            tree.rebuildTree();
          }}
        >
          <CopyMinusIcon />
        </ToolbarButton>
      </div>

      <ContextMenu>
        <ContextMenuTrigger className="relative min-h-0 flex-1">
          <div
            {...tree.getContainerProps('Files in playground')}
            ref={(element) => {
              scroller.current = element;
              tree.registerElement(element);
            }}
            className="explorer-tree"
            // The tree asks for `position: relative`; the scroller fills its panel.
            style={{ position: 'absolute' }}
            onScroll={visible.onScroll}
            onContextMenuCapture={() => setMenuTarget(null)}
          >
            <div
              role="presentation"
              style={{ height: rowCount * ROW_HEIGHT, position: 'relative' }}
            >
              {rows}
            </div>
            {rootLoaded && rowCount === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                This folder is empty. Create a file to get started.
              </p>
            ) : null}
          </div>
          <AssistiveTreeDescription tree={tree} />
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => startCreating('file', menuTarget)}>
            New File…
          </ContextMenuItem>
          <ContextMenuItem onClick={() => startCreating('dir', menuTarget)}>
            New Folder…
          </ContextMenuItem>
          <ContextMenuSeparator />
          {menuTarget === null ? (
            <ContextMenuItem onClick={() => void refreshAll()}>
              Refresh
            </ContextMenuItem>
          ) : (
            <>
              <ContextMenuItem
                disabled={menuTargets.length !== 1}
                onClick={() => {
                  // Let the menu hand focus back before the input takes it.
                  setTimeout(
                    () => tree.getItemInstance(menuTarget).startRenaming(),
                    0,
                  );
                }}
              >
                Rename…
              </ContextMenuItem>
              <ContextMenuItem
                variant="destructive"
                onClick={() => requestDelete(menuTarget)}
              >
                {menuTargets.length > 1
                  ? `Delete ${menuTargets.length} Items`
                  : 'Delete'}
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>

      {error ? (
        <div
          role="alert"
          className="flex shrink-0 items-start gap-1 border-t bg-destructive/10 py-1 pr-1 pl-3 text-xs text-destructive"
        >
          <span className="min-w-0 flex-1 py-0.5">{error}</span>
          <Button
            aria-label="Dismiss"
            size="icon-xs"
            variant="ghost"
            onClick={() => setError(null)}
          >
            <XIcon />
          </Button>
        </div>
      ) : null}

      <DeleteDialog
        paths={pendingDelete}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}

function DeleteDialog({
  paths,
  onCancel,
  onConfirm,
}: {
  /** What is about to be deleted; null while nothing is. */
  paths: string[] | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={paths !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>
            {paths?.length === 1
              ? `Delete ${baseName(paths[0])}?`
              : `Delete ${paths?.length ?? 0} items?`}
          </DialogTitle>
          <DialogDescription>
            This removes {paths?.length === 1 ? 'it' : 'them'} from
            /root/playground, including anything inside folders. It cannot be
            undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ToolbarButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            onClick={onClick}
            size="icon-xs"
            type="button"
            variant="ghost"
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** The inline input for a new entry: Enter creates it, Escape or blur cancels. */
function NameInput({
  label,
  onCommit,
  onCancel,
}: {
  label: string;
  onCommit: (value: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState('');
  const committing = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Wait for the menu or button that opened this to give focus back.
    const timer = setTimeout(() => input.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      onCancel();
    } else if (event.key === 'Enter' && !committing.current) {
      committing.current = true;
      void onCommit(value).finally(() => {
        committing.current = false;
      });
    }
  }

  return (
    <input
      ref={input}
      aria-label={label}
      className="explorer-input"
      spellCheck={false}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => {
        if (!committing.current) onCancel();
      }}
    />
  );
}
