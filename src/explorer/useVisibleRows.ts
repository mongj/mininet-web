import { useLayoutEffect, useState, type RefObject, type UIEvent } from 'react';

/**
 * The window of fixed-height rows to render in a scrolling list: `first` up
 * to, but not including, `last`, which may run past the end of the list.
 */
export function useVisibleRows(
  scrollerRef: RefObject<HTMLElement | null>,
  rowHeight: number,
  overscan: number,
) {
  // The row at the top edge, not the pixel offset, so that scrolling within a
  // row does not render.
  const [topRow, setTopRow] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useLayoutEffect(() => {
    const element = scrollerRef.current;
    if (!element) return;
    const measure = () => setViewportHeight(element.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [scrollerRef]);

  return {
    first: Math.max(0, topRow - overscan),
    last: topRow + Math.ceil(viewportHeight / rowHeight) + 1 + overscan,
    onScroll: (event: UIEvent<HTMLDivElement>) =>
      setTopRow(Math.floor(event.currentTarget.scrollTop / rowHeight)),
  };
}
