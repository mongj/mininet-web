import type { AsyncDataLoaderDataRef, TreeInstance } from '@headless-tree/core';
import { useCallback, useEffect, useRef } from 'react';
import type { ExplorerItem } from '@/explorer/items';
import { parentPath, topMostPaths } from '@/lib/paths';
import type { FileSystemClient } from '@/vm/fs-client';

export const ROOT_ID = '/';

// Item ids are '/' + path, so the root ('/') is not an empty string.
export function idOf(path: string): string {
  return `/${path}`;
}

export function pathOf(id: string): string {
  return id.slice(1);
}

export function parentId(id: string): string {
  return idOf(parentPath(pathOf(id)));
}

export function childrenCache(tree: TreeInstance<ExplorerItem>) {
  return tree.getDataRef<AsyncDataLoaderDataRef<ExplorerItem>>().current
    .childrenIds;
}

/** True when a loaded listing shows that `id`, or a folder above it, is gone. */
export function isGone(tree: TreeInstance<ExplorerItem>, id: string): boolean {
  if (id === ROOT_ID) return false;
  const parent = parentId(id);
  if (isGone(tree, parent)) return true;
  const siblings = childrenCache(tree)?.[parent];
  return siblings !== undefined && !siblings.includes(id);
}

/** Paths of the entries in `ids` that still exist, without the root or any nested inside another. */
export function livePaths(
  tree: TreeInstance<ExplorerItem>,
  ids: string[],
): string[] {
  return topMostPaths(
    ids.filter((id) => id !== ROOT_ID && !isGone(tree, id)).map(pathOf),
  );
}

/** Drops selection, focus and expansion for entries that no longer exist. */
function prune(tree: TreeInstance<ExplorerItem>) {
  const state = tree.getState();
  if (state.selectedItems.some((id) => isGone(tree, id))) {
    tree.setSelectedItems(
      state.selectedItems.filter((id) => !isGone(tree, id)),
    );
  }
  if (state.expandedItems.some((id) => isGone(tree, id))) {
    tree.applySubStateUpdate('expandedItems', (ids) =>
      ids.filter((id) => !isGone(tree, id)),
    );
    tree.rebuildTree();
  }
  if (state.focusedItem !== null && isGone(tree, state.focusedItem)) {
    tree.applySubStateUpdate('focusedItem', null);
  }
}

/** Keeps the loaded listings of `tree` in step with the playground. */
export function useTreeRefresh(
  tree: TreeInstance<ExplorerItem>,
  fs: FileSystemClient,
) {
  const refreshing = useRef(new Map<string, Promise<void>>());
  const refreshAgain = useRef(new Set<string>());

  /**
   * Re-lists a folder whose listing is already loaded. Calls made while a
   * refresh is running are folded into one more pass, so the last listing
   * shown is never older than the last change.
   */
  const refresh = useCallback(
    (id: string): Promise<void> => {
      if (childrenCache(tree)?.[id] === undefined) return Promise.resolve();
      const running = refreshing.current.get(id);
      if (running) {
        refreshAgain.current.add(id);
        return running;
      }
      const run = (async () => {
        try {
          do {
            refreshAgain.current.delete(id);
            // Let a load that began before this change finish first.
            await tree.loadChildrenIds(id);
            await tree.getItemInstance(id).invalidateChildrenIds(true);
          } while (refreshAgain.current.has(id));
        } finally {
          refreshing.current.delete(id);
        }
        prune(tree);
      })();
      refreshing.current.set(id, run);
      return run;
    },
    [tree],
  );

  const refreshAll = useCallback(async () => {
    await Promise.all(Object.keys(childrenCache(tree) ?? {}).map(refresh));
  }, [refresh, tree]);

  useEffect(
    () =>
      fs.onChange((change) => {
        for (const dir of change.dirs) void refresh(idOf(dir));
      }),
    [fs, refresh],
  );

  /**
   * Resolves once the listings show every change reported so far. A file
   * operation reports its changes before it settles, so awaiting this after
   * one is enough to see its result in the tree.
   */
  const settled = useCallback(async () => {
    await Promise.all(refreshing.current.values());
  }, []);

  return { refreshAll, settled };
}
