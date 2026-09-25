import { type VariantProps } from 'class-variance-authority';
import {
  Maximize2Icon,
  Minimize2Icon,
  RotateCwIcon,
  TerminalIcon,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Credits } from '@/components/Credits';
import { SettingsDialog } from '@/components/SettingsDialog';
import { Terminal, type TerminalHandle } from '@/components/Terminal';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge, badgeVariants } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { type Phase, useVirtualMachine } from '@/hooks/useVirtualMachine';

function phaseStatus(phase: Phase): {
  label: string;
  variant: NonNullable<VariantProps<typeof badgeVariants>['variant']>;
} {
  switch (phase) {
    case 'idle':
      return { label: 'Ready to boot', variant: 'outline' };
    case 'downloading':
      return { label: 'Downloading image', variant: 'secondary' };
    case 'booting':
      return { label: 'Booting', variant: 'secondary' };
    case 'shell':
      return { label: 'Shell', variant: 'default' };
    case 'mininet':
      return { label: 'Mininet', variant: 'default' };
    case 'error':
      return { label: 'Error', variant: 'destructive' };
    default: {
      const exhaustive: never = phase;
      return exhaustive;
    }
  }
}

export function App() {
  const terminal = useRef<TerminalHandle>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const write = useCallback(
    (text: string) => terminal.current?.write(text),
    [],
  );
  const clearScreen = useCallback(() => terminal.current?.clear(), []);
  const vm = useVirtualMachine(write, clearScreen);
  const canBoot = vm.phase === 'idle' || vm.phase === 'error';
  const booted = vm.phase === 'shell' || vm.phase === 'mininet';
  const status = phaseStatus(vm.phase);

  useEffect(() => {
    function syncFullscreen() {
      setFullscreen(document.fullscreenElement === panel.current);
    }
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () =>
      document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  function boot() {
    terminal.current?.reset();
    vm.start();
    terminal.current?.focus();
  }

  function toggleFullscreen() {
    const action =
      document.fullscreenElement === panel.current
        ? document.exitFullscreen()
        : panel.current?.requestFullscreen();
    void action?.catch(() => {});
  }

  return (
    <main className="mx-auto flex min-h-svh max-w-7xl flex-col gap-6 p-8">
      <header className="flex min-h-16 items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="flex items-center gap-3 text-xl font-medium tracking-tight">
            Mininet Web Playground
          </h1>
          <p className="w-full text-sm text-muted-foreground">
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
        </div>
        <SettingsDialog />
      </header>

      <Card
        ref={panel}
        aria-label="Lab console"
        data-console=""
        className="min-h-0 min-w-0 flex-1 pb-0"
      >
        <CardHeader className="items-center">
          <div className="flex items-center gap-2">
            <CardTitle>Terminal</CardTitle>
            <Badge variant={status.variant}>
              {vm.phase === 'downloading' || vm.phase === 'booting' ? (
                <Spinner data-icon="inline-start" />
              ) : null}
              {status.label}
            </Badge>
          </div>
          <CardAction className="row-span-1 flex items-center gap-2 self-center">
            {booted ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      id="restart"
                      onClick={boot}
                      type="button"
                      variant="destructive"
                    />
                  }
                >
                  <RotateCwIcon data-icon="inline-start" />
                  Reboot
                </TooltipTrigger>
                <TooltipContent>Discard this session and reboot</TooltipContent>
              </Tooltip>
            ) : null}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
                    onClick={toggleFullscreen}
                    size="icon"
                    type="button"
                    variant="secondary"
                  />
                }
              >
                {fullscreen ? <Minimize2Icon /> : <Maximize2Icon />}
              </TooltipTrigger>
              <TooltipContent>
                {fullscreen ? 'Exit full screen' : 'Full screen'}
              </TooltipContent>
            </Tooltip>
          </CardAction>
        </CardHeader>

        {vm.phase === 'error' ? (
          <div className="px-(--card-spacing)">
            <Alert variant="destructive">
              <AlertTitle>Boot failed</AlertTitle>
              <AlertDescription>
                The guest did not reach a shell. Boot again to retry.
              </AlertDescription>
            </Alert>
          </div>
        ) : null}

        <CardContent className="terminal-surface relative -mx-(--card-spacing) flex min-h-0 flex-1 flex-col">
          {vm.phase === 'downloading' ? (
            <Progress
              aria-label="Linux download progress"
              className="w-full gap-0 **:data-[slot=progress-indicator]:bg-foreground **:data-[slot=progress-track]:rounded-none"
              value={vm.progress ?? 0}
            />
          ) : null}
          <Terminal ref={terminal} onInput={vm.send} />
          {canBoot ? (
            <div className="absolute inset-0 flex items-center justify-center bg-terminal">
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <TerminalIcon />
                  </EmptyMedia>
                  <EmptyTitle>
                    {vm.phase === 'error'
                      ? 'An error occured'
                      : 'Linux is not running'}
                  </EmptyTitle>
                  <EmptyDescription>
                    {vm.phase === 'error'
                      ? 'Discard this session and reboot.'
                      : 'Boot and start a Linux shell in the terminal. The first boot may take around 30 seconds.'}
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button
                    id="boot"
                    onClick={boot}
                    type="button"
                    size="lg"
                    className="w-32"
                  >
                    Boot
                  </Button>
                </EmptyContent>
              </Empty>
            </div>
          ) : null}
        </CardContent>
      </Card>
      {fullscreen ? null : <Credits />}
    </main>
  );
}
