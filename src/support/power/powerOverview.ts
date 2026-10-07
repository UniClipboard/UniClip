import type { PowerAggregate } from './types';

export type PowerStateKey = 'foreground' | 'backgroundScreenOn' | 'backgroundScreenOff';

export interface PowerStateOverview {
  key: PowerStateKey;
  durationMs: number;
  /** App process CPU time; null when no source was readable for the period. */
  cpuMs: number | null;
  /** UID network bytes (received + sent); null when unavailable. */
  networkBytes: number | null;
}

export type PowerBatteryState = 'ready' | 'collecting' | 'unavailable' | 'suspect';

/** What the settings page shows. Everything user-facing is derived here from the shared aggregate. */
export interface PowerOverview {
  coveredMs: number;
  uncoveredMs: number;
  states: PowerStateOverview[];
  /** Whole-device figures. Never attributable to this app. */
  battery: { state: PowerBatteryState; levelDeltaPct: number | null; coverageMs: number; ratePctPerHour: number | null };
  serviceMs: number;
  engineEventCount: number;
}

function sumNullable(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0);
}

export function buildPowerOverview(aggregate: PowerAggregate): PowerOverview {
  const select = (match: (b: PowerAggregate['buckets'][number]) => boolean) => aggregate.buckets.filter(match);
  const state = (key: PowerStateKey, buckets: PowerAggregate['buckets']): PowerStateOverview => ({
    key,
    durationMs: buckets.reduce((n, b) => n + b.durationMs, 0),
    cpuMs: sumNullable(buckets.map((b) => b.cpuMs)),
    networkBytes: sumNullable(buckets.flatMap((b) => [b.rxBytes, b.txBytes])),
  });
  const battery = aggregate.device;
  return {
    coveredMs: aggregate.coveredMs,
    uncoveredMs: aggregate.uncoveredMs,
    states: [
      state('foreground', select((b) => b.key.app === 'fg')),
      state('backgroundScreenOn', select((b) => b.key.app === 'bg' && b.key.screen === 'on')),
      state('backgroundScreenOff', select((b) => b.key.app === 'bg' && b.key.screen === 'off')),
    ],
    battery: {
      state: battery.status === 'valid' ? 'ready' : battery.status === 'suspect' ? 'suspect' : battery.status === 'unavailable' ? 'unavailable' : 'collecting',
      levelDeltaPct: battery.levelDeltaPct,
      coverageMs: battery.coverageMs,
      ratePctPerHour: battery.levelRatePctPerHour,
    },
    serviceMs: aggregate.buckets.reduce((n, b) => n + b.serviceMs, 0),
    engineEventCount: aggregate.buckets.reduce((n, b) => n + Object.values(b.engineEvents).reduce((x, y) => x + y, 0), 0),
  };
}
