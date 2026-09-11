import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { getEngineDiagnosticStatus, startEngineDiagnosticCapture, stopEngineDiagnosticCapture, type EngineCaptureStatus } from 'uc-engine';

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
      } else { await startEngineDiagnosticCapture(600_000); }
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
