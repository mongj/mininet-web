import { useCallback, useEffect, useState } from 'react';
import { TerminalSession } from '@/components/Terminal';
import { TopBar } from '@/components/TopBar';
import { useVirtualMachine } from '@/hooks/useVirtualMachine';
import { Workspace } from '@/workspace/Workspace';

export function App() {
  const [terminal] = useState(() => new TerminalSession());
  const write = useCallback((text: string) => terminal.write(text), [terminal]);
  const vm = useVirtualMachine(write);
  const { start, send } = vm;

  useEffect(() => {
    terminal.setInputHandler(send);
  }, [terminal, send]);

  const boot = useCallback(() => {
    terminal.reset();
    void start();
    terminal.focus();
  }, [terminal, start]);

  return (
    <main className="flex h-full flex-col bg-(--dock-gutter)">
      <Workspace vm={vm} terminal={terminal} boot={boot}>
        <TopBar />
      </Workspace>
    </main>
  );
}
