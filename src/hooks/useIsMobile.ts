import { useSyncExternalStore } from 'react';

/** Below Tailwind's `md` breakpoint (768px). */
export const MOBILE_MEDIA_QUERY = '(max-width: 767px)';

export function viewportIsMobile(): boolean {
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

function subscribe(onStoreChange: () => void): () => void {
  const query = window.matchMedia(MOBILE_MEDIA_QUERY);
  query.addEventListener('change', onStoreChange);
  return () => query.removeEventListener('change', onStoreChange);
}

function isMobileViewport(): boolean {
  return viewportIsMobile();
}

/** True while the viewport is narrow enough to use the mobile layout. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, isMobileViewport, () => false);
}
