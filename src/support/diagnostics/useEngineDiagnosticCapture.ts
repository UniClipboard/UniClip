import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { getEngineDiagnosticStatus, startEngineDiagnosticCapture, startNetworkLogCapture, stopEngineDiagnosticCapture, stopNetworkLogCapture, type EngineCaptureStatus } from 'uc-engine';

const CAPTURE_DURATION_MS = 600_000;
// The network window is linked to the business Detailed switch but is its own capture with its own
// outcome. Its id lives for the process only: the Engine ends the window on its own.
let networkCaptureId: string | null = null;

async function startLinkedNetworkCapture(): Promise<void> {
  try {
    const result = await startNetworkLogCapture(CAPTURE_DURATION_MS);
    if (result.ok) networkCaptureId = result.value.captureId;
  } catch { /* A network log problem never fails the business capture. */ }
}

async function stopLinkedNetworkCapture(): Promise<void> {
  const id = networkCaptureId;
  networkCaptureId = null;
  if (id === null) return;
  try { await stopNetworkLogCapture(id); } catch { /* Already ended or unavailable. */ }
}

/** Engine owns the timer. Navigating away does not end the user's capture. */
export function useEngineDiagnosticCapture() {
  const [capture, setCapture] = useState<EngineCaptureStatus | null>(null);
  const [available, setAvailable] = useState(false);
  const [operationState, setOperationState] = useState<'idle' | 'pending' | 'failed'>('idle');
  const inFlight = useRef(false);
  const refreshing = useRef(false);
  const revision = useRef(0);
  const mounted = useRef(false);
  const refresh = useCallback(async () => {
    if (inFlight.current || refreshing.current || AppState.currentState !== 'active') return;
    refreshing.current = true;
    const requestedRevision = revision.current;
    try {
      const status = await getEngineDiagnosticStatus();
      if (mounted.current && requestedRevision === revision.current) { setCapture(status.capture); setAvailable(status.localFile === 'ready' && !status.closed); }
    } catch { if (mounted.current && requestedRevision === revision.current) { setCapture(null); setAvailable(false); } }
    finally { refreshing.current = false; }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), 2_000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void refresh(); });
    return () => { mounted.current = false; clearInterval(timer); subscription.remove(); };
  }, [refresh]);
  const toggle = useCallback(async () => {
    if (inFlight.current || !available) return;
    inFlight.current = true;
    revision.current += 1;
    setOperationState('pending');
    let outcome: 'idle' | 'failed' = 'idle';
    try {
      if (capture?.mode === 'detailed' && capture.captureId) {
        await stopEngineDiagnosticCapture(capture.captureId);
        await stopLinkedNetworkCapture();
      } else {
        await startEngineDiagnosticCapture(CAPTURE_DURATION_MS);
        await startLinkedNetworkCapture();
      }
      const status = await getEngineDiagnosticStatus();
      if (mounted.current) { setCapture(status.capture); setAvailable(status.localFile === 'ready' && !status.closed); }
    } catch {
      outcome = 'failed';
    } finally {
      inFlight.current = false;
      if (mounted.current) setOperationState(outcome);
    }
  }, [available, capture]);
  return { active: capture?.mode === 'detailed', remainingMinutes: Math.ceil((capture?.remainingMs ?? 0) / 60_000), available, busy: operationState === 'pending', failed: operationState === 'failed', toggle };
}
