import { useCallback, useEffect, useState } from 'react';
import { loadPowerMetrics, resetPowerMetrics } from './powerMetrics';
import { buildPowerOverview, type PowerOverview } from './powerOverview';

export type PowerOverviewState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'ready'; overview: PowerOverview; hasSamples: boolean };

/** Loads the last-24-hours overview once on mount; `reset` clears local statistics and reloads. */
export function usePowerOverview() {
  const [state, setState] = useState<PowerOverviewState>({ status: 'loading' });

  const load = useCallback(async () => {
    const metrics = await loadPowerMetrics().catch(() => null);
    setState(
      metrics
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
