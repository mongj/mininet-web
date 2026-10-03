import { useLayoutEffect, useRef, useState, type UIEvent } from 'react';

/**
 * The window of fixed-height rows to render in a scrolling list: `first` up
 * to, but not including, `last`, which may run past the end of the list.
 */
export function useVisibleRows(rowHeight: number, overscan: number) {
  const scroller = useRef<HTMLDivElement>(null);
  // The row at the top edge, not the pixel offset, so that scrolling within a
  // row does not render.
  const [topRow, setTopRow] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () => setViewportHeight(element.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return {
    scroller,
    first: Math.max(0, topRow - overscan),
    last: topRow + Math.ceil(viewportHeight / rowHeight) + 1 + overscan,
    onScroll: (event: UIEvent<HTMLDivElement>) =>
      setTopRow(Math.floor(event.currentTarget.scrollTop / rowHeight)),
  };
}
