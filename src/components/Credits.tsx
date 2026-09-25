import { HeartIcon } from 'lucide-react';

export function Credits() {
  return (
    <footer className="mt-auto text-center text-xs text-muted-foreground">
      <p className="inline-flex flex-wrap items-center justify-center gap-x-1">
        <span className="inline-flex items-center gap-1">
          made with
          <HeartIcon aria-hidden className="size-4 fill-current" />
          by
          <a
            className="link-dashed"
            href="https://github.com/mongj"
            rel="noreferrer"
            target="_blank"
          >
            mongj
          </a>
        </span>
        <span aria-hidden>·</span>
        <span>
          <a
            className="link-dashed"
            href="https://github.com/copy/v86"
            rel="noreferrer"
            target="_blank"
          >
            v86
          </a>
          &nbsp; 0.5.381
        </span>
        <span aria-hidden>·</span>
        <span>
          <a
            className="link-dashed"
            href="https://github.com/mininet/mininet"
            rel="noreferrer"
            target="_blank"
          >
            Mininet
          </a>
          &nbsp; 2.3.0
        </span>
      </p>
    </footer>
  );
}
