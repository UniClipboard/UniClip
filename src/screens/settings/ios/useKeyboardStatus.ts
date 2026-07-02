import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { getKeyboardStatus, type KeyboardStatusDTO } from 'app-group-store';

export type KeyboardSetupState =
  | 'notAdded' // not in the system keyboard list
  | 'added' // in the list, but Full Access is off (or not yet confirmable)
  | 'ready' // in the list and last heartbeat had Full Access
  | 'unknown'; // system list unreadable and the keyboard never ran

export interface KeyboardStatusView {
  raw: KeyboardStatusDTO | null;
  state: KeyboardSetupState;
  /** Best-effort "is in the system keyboard list". */
  added: boolean;
  /**
   * Full Access as of the keyboard's last appearance. Only meaningful when
   * `heartbeatSeen`; a keyboard that was added but never opened cannot report.
   */
  fullAccess: boolean;
  heartbeatSeen: boolean;
  refresh: () => Promise<void>;
}

function deriveState(status: KeyboardStatusDTO | null): {
  state: KeyboardSetupState;
  added: boolean;
} {
  if (!status) return { state: 'unknown', added: false };
  const added = status.enabledInSystem ?? status.everUsed;
  if (status.enabledInSystem === null && !status.everUsed) {
    return { state: 'unknown', added: false };
  }
  if (!added) return { state: 'notAdded', added: false };
  const ready = status.everUsed && status.lastKnownFullAccess;
  return { state: ready ? 'ready' : 'added', added: true };
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

  const { state, added } = deriveState(raw);
  return {
    raw,
    state,
    added,
    fullAccess: (raw?.everUsed ?? false) && (raw?.lastKnownFullAccess ?? false),
    heartbeatSeen: raw?.everUsed ?? false,
    refresh,
  };
}
