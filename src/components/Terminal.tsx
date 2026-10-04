import { FitAddon } from '@xterm/addon-fit';
import { Terminal as Xterm, type ITheme } from '@xterm/xterm';
import { useEffect, useRef } from 'react';

function readToken(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

const ANSI_COLORS = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
] as const;

// Every color is a CSS token, so the appearance blocks in globals.css decide
// the theme. A missing token leaves xterm's default in place.
function readTerminalTheme(): ITheme {
  const token = (name: string) => readToken(`--terminal-${name}`) || undefined;
  const theme: ITheme = {
    background: readToken('--terminal') || undefined,
    foreground: token('foreground'),
    cursor: token('cursor'),
    cursorAccent: readToken('--terminal') || undefined,
    selectionBackground: token('selection'),
  };
  for (const color of ANSI_COLORS) {
    const bright =
      `bright${color[0].toUpperCase()}${color.slice(1)}` as `bright${Capitalize<typeof color>}`;
    theme[color] = token(color);
    theme[bright] = token(`bright-${color}`);
  }
  return theme;
}

/**
 * The xterm instance, kept apart from any view so serial output and
 * scrollback survive its panel being hidden, moved or closed.
 */
export class TerminalSession {
  private readonly xterm: Xterm;
  private readonly fitAddon = new FitAddon();
  private readonly host = document.createElement('div');
  private opened = false;
  private onInput: (text: string) => void = () => {};

  constructor() {
    this.xterm = new Xterm({
      fontFamily:
        readToken('--font-mono') ||
        'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      cursorBlink: true,
      screenReaderMode: true,
      scrollback: 6000,
      theme: readTerminalTheme(),
    });
    this.xterm.loadAddon(this.fitAddon);
    this.xterm.onData((text) => this.onInput(text));
    this.host.className = 'terminal-host';
    this.host.setAttribute('aria-label', 'Interactive terminal');
  }

  setInputHandler(onInput: (text: string) => void): void {
    this.onInput = onInput;
  }

  write(text: string): void {
    this.xterm.write(text);
  }

  reset(): void {
    this.xterm.reset();
  }

  focus(): void {
    this.xterm.focus();
  }

  /** Shows the terminal inside `container`; returns the detach function. */
  mount(container: HTMLElement): () => void {
    container.appendChild(this.host);
    if (!this.opened) {
      this.xterm.open(this.host);
      this.opened = true;
    }
    this.fit();
    const observer = new ResizeObserver(() => this.fit());
    observer.observe(container);
    // The theme comes from CSS tokens, which change with the root's appearance
    // class and, when that is unset, with the system setting.
    const applyTheme = () => {
      this.xterm.options.theme = readTerminalTheme();
    };
    applyTheme();
    const appearance = new MutationObserver(applyTheme);
    appearance.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    const system = window.matchMedia('(prefers-color-scheme: dark)');
    system.addEventListener('change', applyTheme);
    return () => {
      observer.disconnect();
      appearance.disconnect();
      system.removeEventListener('change', applyTheme);
      if (this.host.parentElement === container) this.host.remove();
    };
  }

  // A resize makes xterm re-measure the glyph cell, so the rows the first fit
  // chose can overflow the host when the cell grew (for example after the web
  // font swapped in). Fitting again settles on the new cell size.
  private fit(): void {
    if (!this.opened || !this.host.isConnected) return;
    this.fitAddon.fit();
    this.fitAddon.fit();
  }
}

export function TerminalView({ session }: { session: TerminalSession }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return;
    return session.mount(container.current);
  }, [session]);

  return <div ref={container} className="absolute inset-0 bg-terminal" />;
}
