import { File } from 'expo-file-system';
import { getPowerMetrics, resetPowerMetrics, type PowerMetricsSnapshot } from 'uc-engine';
import { aggregatePowerSamples, parsePowerSamples } from './aggregatePowerSamples';
import type { PowerAggregate, PowerSample } from './types';

export const POWER_OVERVIEW_PERIOD_MS = 24 * 60 * 60 * 1000;
const MAX_POWER_FILE_BYTES = 4 * 1024 * 1024;

export interface PowerMetrics {
  snapshot: PowerMetricsSnapshot;
  samples: PowerSample[];
  rawText: string;
  /** Last 24 hours, for the overview. */
  recent: PowerAggregate;
  /** Everything still retained, for the export. */
  retained: PowerAggregate;
}

/**
 * Reads the local power samples (taking a fresh boundary sample first) and aggregates them.
 * Returns null when this platform has no recorder; throws nothing for missing or partial data.
 */
export async function loadPowerMetrics(now = Date.now()): Promise<PowerMetrics | null> {
  let snapshot: PowerMetricsSnapshot | null = null;
  try { snapshot = await getPowerMetrics(); } catch { return null; }
  if (!snapshot) return null;
  let rawText = '';
  if (snapshot.fileUri) {
    try {
      const file = new File(snapshot.fileUri);
      if (file.size <= MAX_POWER_FILE_BYTES) rawText = await file.text();
    } catch { /* An unreadable file reads as no samples; the snapshot still reports sampleCount. */ }
  }
  const { samples, malformed } = parsePowerSamples(rawText);
  return {
    snapshot, samples, rawText,
    recent: aggregatePowerSamples(samples, { sinceWallMs: now - POWER_OVERVIEW_PERIOD_MS, malformed }),
    retained: aggregatePowerSamples(samples, { malformed }),
  };
}

export { resetPowerMetrics };
