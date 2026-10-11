import { clearTimer, setTimer } from 'native-timer';

/**
 * Runs `callback` once after `delayMs` on the native timer, which keeps firing while the Android
 * activity is paused (JS timers do not). Returns a cancel function; cancelling twice is harmless.
 */
export function scheduleOnce(callback: () => void, delayMs: number): () => void {
  let tag: string | null = setTimer(() => {
    if (!tag) return;
    clearTimer(tag);
    tag = null;
    callback();
  }, delayMs);
  return () => {
    if (!tag) return;
    clearTimer(tag);
    tag = null;
  };
}
