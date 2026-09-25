import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { getKeyboardStatus, type KeyboardStatusDTO } from 'app-group-store';

export type KeyboardSetupState =
  | 'notAdded' // not in the system keyboard list
  | 'added' // in the list, Full Access not confirmed
  | 'ready' // in the list and a heartbeat confirmed Full Access
  | 'unknown'; // system list unreadable and no heartbeat ever landed

export interface KeyboardStatusView {
  raw: KeyboardStatusDTO | null;
  state: KeyboardSetupState;
  /** Best-effort "is in the system keyboard list". */
  added: boolean;
  /**
   * When a heartbeat last confirmed Full Access (epoch ms). The keyboard can
   * only reach the App Group with Full Access on, so it can never report the
   * permission being turned off: this proves Full Access at that moment, not
   * now. `null` means unconfirmed, which is not the same as off.
   */
  fullAccessConfirmedAtMs: number | null;
  /** A heartbeat said Full Access is off (only if iOS ever lets one land). */
  fullAccessKnownOff: boolean;
  refresh: () => Promise<void>;
}

export function deriveKeyboardStatus(status: KeyboardStatusDTO | null) {
  const heartbeatAt = status?.lastHeartbeatAtMs ?? null;
  const fullAccessConfirmedAtMs =
    heartbeatAt !== null && status?.lastKnownFullAccess ? heartbeatAt : null;
  const fullAccessKnownOff = heartbeatAt !== null && !status?.lastKnownFullAccess;
  const added = status?.enabledInSystem ?? heartbeatAt !== null;
  let state: KeyboardSetupState;
  if (!status || (status.enabledInSystem === null && heartbeatAt === null)) state = 'unknown';
  else if (!added) state = 'notAdded';
  else state = fullAccessConfirmedAtMs !== null ? 'ready' : 'added';
  return {
    state,
    added: state === 'unknown' ? false : added,
    fullAccessConfirmedAtMs,
    fullAccessKnownOff,
  };
}

/**
 * Live keyboard-extension setup status. Refreshes on mount and whenever the
 * app returns to foreground (the user flips the toggles in the Settings app
 * and comes back). Pass `pollMs` on pages with an in-page tryout field: the
 * heartbeat lands the moment the keyboard appears, and polling picks it up
 * without leaving the app.
 */
export function useKeyboardStatus(options?: { pollMs?: number }): KeyboardStatusView {
  const pollMs = options?.pollMs;
  const [raw, setRaw] = useState<KeyboardStatusDTO | null>(null);

  const refresh = useCallback(async () => {
    try {
      setRaw(await getKeyboardStatus());
    } catch {
      // leave the last known snapshot in place
    }
  }, []);

  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  useEffect(() => {
    if (!pollMs) return;
    const id = setInterval(refresh, pollMs);
    return () => clearInterval(id);
  }, [pollMs, refresh]);

  return { raw, ...deriveKeyboardStatus(raw), refresh };
}
