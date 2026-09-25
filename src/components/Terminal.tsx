import { FitAddon } from '@xterm/addon-fit';
import { Terminal as Xterm } from '@xterm/xterm';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

export interface TerminalHandle {
  write: (text: string) => void;
  clear: () => void;
  reset: () => void;
  focus: () => void;
}

interface TerminalProps {
  onInput: (text: string) => void;
}

function readToken(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

function readTerminalTheme() {
  return {
    background: readToken('--terminal') || readToken('--background'),
    foreground: readToken('--foreground'),
    cursor: readToken('--terminal-cursor') || readToken('--primary'),
    selectionBackground:
      readToken('--terminal-selection') || readToken('--muted'),
  };
}

export const Terminal = forwardRef<TerminalHandle, TerminalProps>(
  function Terminal({ onInput }, ref) {
    const container = useRef<HTMLDivElement>(null);
    const terminal = useRef<Xterm | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        write: (text) => terminal.current?.write(text),
        clear: () => {
          const instance = terminal.current;
          if (!instance) return;
          instance.reset();
          instance.write('\x1b[3J\x1b[H\x1b[2J');
        },
        reset: () => terminal.current?.reset(),
        focus: () => terminal.current?.focus(),
      }),
      [],
    );

    useEffect(() => {
      if (!container.current) return;
      const instance = new Xterm({
        fontFamily:
          readToken('--font-mono') ||
          'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 14,
        lineHeight: 1.25,
        cursorBlink: true,
        screenReaderMode: true,
        scrollback: 6000,
        theme: readTerminalTheme(),
      });
      const fit = new FitAddon();
      instance.loadAddon(fit);
      instance.open(container.current);
      terminal.current = instance;
      // A resize makes xterm re-measure the glyph cell, so the rows the first
      // fit chose can overflow the host when the cell grew (for example after
      // the web font swapped in). Fitting again settles on the new cell size.
      const settle = () => {
        fit.fit();
        fit.fit();
      };
      const refit = () => {
        requestAnimationFrame(settle);
      };
      settle();
      const input = instance.onData(onInput);
      const observer = new ResizeObserver(settle);
      observer.observe(container.current);
      document.addEventListener('fullscreenchange', refit);

      const root = document.documentElement;
      const themeObserver = new MutationObserver(() => {
        instance.options.theme = readTerminalTheme();
      });
      themeObserver.observe(root, {
        attributes: true,
        attributeFilter: ['class'],
      });

      return () => {
        document.removeEventListener('fullscreenchange', refit);
        themeObserver.disconnect();
        observer.disconnect();
        input.dispose();
        instance.dispose();
        terminal.current = null;
      };
    }, [onInput]);

    return (
      <div
        ref={container}
        aria-label="Interactive terminal"
        className="terminal-host w-full bg-terminal"
      />
    );
  },
);
