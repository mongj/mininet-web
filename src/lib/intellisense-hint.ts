export const INTELLISENSE_HINT_KEY = 'mininet-web:intellisense-hint';

/** Whether the first-open editor hint has already been shown. */
export function hasSeenIntelliSenseHint(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(INTELLISENSE_HINT_KEY) === '1';
  } catch (error) {
    console.error(error);
    return false;
  }
}

/** Records that the editor has been opened, so the hint is not shown again. */
export function rememberIntelliSenseHint(): void {
  try {
    localStorage.setItem(INTELLISENSE_HINT_KEY, '1');
  } catch (error) {
    console.error(error);
  }
}
