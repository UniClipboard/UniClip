/** Raw power sample written by the Android host. See docs/specs/006-android-power-metrics.md. `null` means unavailable. */
export type PowerSampleReason =
  | 'process.start' | 'app.foreground' | 'app.background' | 'screen.on' | 'screen.off'
  | 'power.connected' | 'power.disconnected' | 'doze.changed' | 'powersave.changed'
  | 'service.started' | 'service.stopped' | 'engine.start' | 'engine.suspend'
  | 'engine.resume' | 'engine.shutdown' | 'network.changed' | 'query' | 'reset';

export type PowerPlugged = 'none' | 'ac' | 'usb' | 'wireless' | 'dock' | 'unknown';

export interface PowerSample {
  v: 1;
  seq: number;
  reason: PowerSampleReason;
  wallMs: number;
  elapsedMs: number;
  uptimeMs: number;
  epoch: { boot: number | null; procStartElapsedMs: number; pid: number };
  ctx: {
    app: 'fg' | 'bg' | null;
    importance: number | null;
    screen: boolean | null;
    plugged: PowerPlugged | null;
    doze: boolean | null;
    powerSave: boolean | null;
    service: boolean;
    engine: boolean;
    net: string | null;
    bucket: number | null;
    bgRestricted: boolean | null;
  };
  dev: {
    levelPct: number | null;
    chargeUah: number | null;
    energyNwh: number | null;
    currentNowUa: number | null;
    currentAvgUa: number | null;
  };
  app: {
    cpuMs: number | null;
    rxBytes: number | null;
    txBytes: number | null;
    health: { wakeMs: number | null; cpuUserMs: number | null; cpuSysMs: number | null; radioMs: number | null } | null;
  };
  cnt: { engineEvents: Record<string, number>; droppedSamples: number };
  self: { samples: number; costUs: number; cpuUs: number; binderCalls: number };
  /** Set on the first retained sample after retention compaction dropped older samples. */
  trunc?: true;
  prevExit?: { reason: string; importance: number | null; timestampMs: number | null } | null;
}

export type DeviceStatus = 'valid' | 'suspect' | 'unavailable' | 'insufficient';

export interface BucketKey { app: 'fg' | 'bg'; screen: 'on' | 'off'; charging: boolean }

export interface BucketTotals {
  key: BucketKey;
  durationMs: number;
  windowCount: number;
  cpuMs: number | null;
  rxBytes: number | null;
  txBytes: number | null;
  wakeMs: number | null;
  serviceMs: number;
  engineEvents: Record<string, number>;
  dozeMs: number;
}

export interface DeviceBattery {
  scope: 'device';
  status: DeviceStatus;
  /** Discharging coverage in ms over which the numbers below were computed. */
  coverageMs: number;
  levelDeltaPct: number | null;
  chargeDeltaUah: number | null;
  energyDeltaNwh: number | null;
  /** Percent per hour, only when status is valid/suspect and coverage is long enough. */
  levelRatePctPerHour: number | null;
}

export interface PowerAggregate {
  buckets: BucketTotals[];
  coveredMs: number;
  uncoveredMs: number;
  windowCount: number;
  flags: { clockAdjusted: number; counterReset: number; coalesced: number; gaps: number };
  device: DeviceBattery;
  /** Device battery change split by screen/app state, discharging coverage only. */
  deviceByState: { key: Omit<BucketKey, 'charging'>; coverageMs: number; levelDeltaPct: number | null }[];
  malformed: number;
  retention: { truncated: boolean; sampleCount: number };
  self: { samples: number; costUs: number; cpuUs: number; binderCalls: number } | null;
  prevExits: { reason: string; timestampMs: number | null }[];
  appEnergy: 'unavailable';
}
