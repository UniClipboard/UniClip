import { File } from 'expo-file-system';
import { getPowerMetrics, resetPowerMetrics, type PowerMetricsSnapshot } from 'uc-engine';
import { aggregatePowerSamples, parsePowerSamples } from './aggregatePowerSamples';
import type { PowerAggregate, PowerSample } from './types';

export const POWER_OVERVIEW_PERIOD_MS = 24 * 60 * 60 * 1000;
const MAX_POWER_FILE_BYTES = 4 * 1024 * 1024;

/** `none`: nothing written yet. `oversized`/`unreadable`: the file exists but was not read, so the samples are incomplete. */
export type PowerFileStatus = 'none' | 'read' | 'oversized' | 'unreadable';

export interface PowerMetrics {
  snapshot: PowerMetricsSnapshot;
  fileStatus: PowerFileStatus;
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
  let fileStatus: PowerFileStatus = 'none';
  if (snapshot.fileUri) {
    try {
      const file = new File(snapshot.fileUri);
      if (file.size <= MAX_POWER_FILE_BYTES) { rawText = await file.text(); fileStatus = 'read'; }
      else fileStatus = 'oversized';
    } catch { fileStatus = 'unreadable'; }
  }
  const { samples, malformed } = parsePowerSamples(rawText);
  return {
    snapshot, fileStatus, samples, rawText,
    recent: aggregatePowerSamples(samples, { sinceWallMs: now - POWER_OVERVIEW_PERIOD_MS, malformed }),
    retained: aggregatePowerSamples(samples, { malformed }),
  };
}

export { resetPowerMetrics };
