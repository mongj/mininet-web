import type { ItemInstance } from '@headless-tree/core';
import { ChevronRightIcon, FolderIcon, FolderOpenIcon } from 'lucide-react';
import type { CSSProperties, MouseEvent, RefObject } from 'react';
import { FileTypeIcon } from '@/components/FileTypeIcon';
import type { ExplorerItem } from '@/explorer/items';

interface ExplorerRowProps {
  item: ItemInstance<ExplorerItem>;
  style: CSSProperties;
  /** The id of the item whose name was selected for the rename in progress. */
  renameSelected: RefObject<string | null>;
  onActivate: (item: ItemInstance<ExplorerItem>) => void;
  onContextMenu: (id: string) => void;
}

export function ExplorerRow({
  item,
  style,
  renameSelected,
  onActivate,
  onContextMenu,
}: ExplorerRowProps) {
  const data = item.getItemData();
  const id = item.getId();
  const props = item.getProps();
  const FolderGlyph = item.isExpanded() ? FolderOpenIcon : FolderIcon;
  return (
    <div
      {...props}
      className="explorer-row"
      data-selected={item.isSelected() || undefined}
      data-drop-target={item.isDragTarget() || undefined}
      title={data.kind === 'symlink' ? `Link to ${data.target}` : undefined}
      style={style}
      onClick={(event: MouseEvent) => {
        props.onClick?.(event);
        if (!event.shiftKey && !event.ctrlKey && !event.metaKey) {
          onActivate(item);
        }
      }}
      onContextMenu={() => {
        onContextMenu(id);
        if (!item.isSelected()) item.getTree().setSelectedItems([id]);
        item.setFocused();
      }}
    >
      <span className="explorer-twistie">
        {data.kind === 'dir' ? (
          <ChevronRightIcon
            className="size-4 transition-transform data-expanded:rotate-90"
            data-expanded={item.isExpanded() || undefined}
          />
        ) : null}
      </span>
      {data.kind === 'dir' ? (
        <FolderGlyph className="explorer-icon" />
      ) : (
        <FileTypeIcon
          name={data.name}
          symlink={data.kind === 'symlink'}
          className="explorer-icon"
        />
      )}
      {item.isRenaming() ? (
        <input
          {...item.getRenameInputProps()}
          aria-label="New name"
          className="explorer-input"
          spellCheck={false}
          onClick={(event) => event.stopPropagation()}
          onFocus={(event) => {
            // The input is refocused on every render; select the name once.
            if (renameSelected.current === id) return;
            renameSelected.current = id;
            const dot = event.target.value.lastIndexOf('.');
            event.target.setSelectionRange(
              0,
              dot > 0 ? dot : event.target.value.length,
            );
          }}
        />
      ) : (
        <span className="truncate">{data.name}</span>
      )}
    </div>
  );
}
