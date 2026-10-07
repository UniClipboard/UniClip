import { useCallback, useEffect, useRef, useState } from 'react';
import { loadPowerMetrics, resetPowerMetrics } from './powerMetrics';
import { buildPowerOverview, type PowerOverview } from './powerOverview';

export type PowerOverviewState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'ready'; overview: PowerOverview; hasSamples: boolean };

/** Loads the last-24-hours overview once on mount; `reset` clears local statistics and reloads. */
export function usePowerOverview() {
  const [state, setState] = useState<PowerOverviewState>({ status: 'loading' });
  const latestRequest = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const load = useCallback(async () => {
    // Only the newest request may write state, so a slow mount load cannot overwrite the post-reset view.
    const request = ++latestRequest.current;
    const metrics = await loadPowerMetrics().catch(() => null);
    if (!mounted.current || request !== latestRequest.current) return;
    setState(
      metrics && metrics.fileStatus !== 'oversized' && metrics.fileStatus !== 'unreadable'
        ? { status: 'ready', overview: buildPowerOverview(metrics.recent), hasSamples: metrics.samples.length > 1 }
        : { status: 'unavailable' }
    );
  }, []);

  useEffect(() => { void load(); }, [load]);

  const reset = useCallback(async () => {
    const cleared = await resetPowerMetrics().catch(() => false);
    await load();
    return cleared;
  }, [load]);

  return { state, reset };
}
