import { createContext, useContext } from 'react';
import type { TerminalSession } from '@/components/Terminal';
import type { DocumentStore } from '@/editor/documents';
import type { useVirtualMachine } from '@/hooks/useVirtualMachine';

export interface WorkspaceValue {
  vm: ReturnType<typeof useVirtualMachine>;
  /** Linux is up and serving /root/playground to the host. */
  filesReady: boolean;
  terminal: TerminalSession;
  documents: DocumentStore;
  boot: () => void;
  openFile: (path: string) => void;
  /** Moves a file or folder, carrying its open editors along. */
  movePath: (from: string, to: string) => Promise<void>;
  /** Deletes a file or folder and closes its editors. */
  deletePath: (path: string) => Promise<void>;
  /**
   * Closes the tabs that can be closed, asking first when a file among them
   * has unsaved changes.
   */
  closeTabs: (panelIds: string[]) => void;
  /** Focuses the Welcome tab, adding it back if it was closed. */
  showWelcome: () => void;
  resetLayout: () => void;
}

export const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used within Workspace');
  return value;
}
