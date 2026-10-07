import type { BucketKey, BucketTotals, DeviceBattery, PowerAggregate, PowerSample } from './types';

/** Longest tolerated disagreement between wall-clock and monotonic deltas before a window is flagged. */
const CLOCK_SKEW_TOLERANCE_MS = 2000;
/** Discharge coverage required before a battery rate is reported. */
const MIN_DISCHARGE_COVERAGE_MS = 10 * 60_000;
/** Level drop with a frozen charge counter that marks the counter as stuck. */
const SUSPECT_LEVEL_DROP_PCT = 2;

export interface AggregateOptions {
  /** Only windows starting at or after this wall-clock time are included. */
  sinceWallMs?: number;
  /** Lines the parser rejected, carried into the aggregate so partial data is visible. */
  malformed?: number;
}

export function parsePowerSamples(text: string): { samples: PowerSample[]; malformed: number } {
  const samples: PowerSample[] = [];
  let malformed = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line) as PowerSample;
      const valid = value && value.v === 1 && Number.isFinite(value.seq) && Number.isFinite(value.elapsedMs)
        && Number.isFinite(value.wallMs) && value.epoch && value.ctx && value.dev && value.app && value.cnt;
      if (valid) samples.push(value);
      else malformed += 1;
    } catch {
      malformed += 1;
    }
  }
  return { samples, malformed };
}

type Delta = { value: number | null; reset: boolean };

/** Difference of two cumulative counters; null when either side is unavailable, reset when it went backwards. */
function delta(a: number | null | undefined, b: number | null | undefined): Delta {
  if (a == null || b == null) return { value: null, reset: false };
  if (b < a) return { value: null, reset: true };
  return { value: b - a, reset: false };
}

function addNullable(total: number | null, part: number | null): number | null {
  return part == null ? total : (total ?? 0) + part;
}

function sameEpoch(a: PowerSample, b: PowerSample): boolean {
  return a.epoch.boot === b.epoch.boot && a.epoch.procStartElapsedMs === b.epoch.procStartElapsedMs && a.epoch.pid === b.epoch.pid;
}

function bucketFor(buckets: Map<string, BucketTotals>, key: BucketKey): BucketTotals {
  const id = `${key.app}/${key.screen}/${key.charging}`;
  let bucket = buckets.get(id);
  if (!bucket) {
    bucket = { key, durationMs: 0, windowCount: 0, cpuMs: null, rxBytes: null, txBytes: null, wakeMs: null, serviceMs: 0, engineEvents: {}, dozeMs: 0 };
    buckets.set(id, bucket);
  }
  return bucket;
}

export function aggregatePowerSamples(input: PowerSample[], options: AggregateOptions = {}): PowerAggregate {
  const samples = [...input].sort((x, y) => x.seq - y.seq);
  const buckets = new Map<string, BucketTotals>();
  const flags = { clockAdjusted: 0, counterReset: 0, coalesced: 0, gaps: 0 };
  let coveredMs = 0;
  let uncoveredMs = 0;
  let windowCount = 0;

  let coverageMs = 0;
  let levelDelta: number | null = null;
  let chargeDelta: number | null = null;
  let energyDelta: number | null = null;
  let sawDeviceValue = false;
  const byState = new Map<string, { key: { app: 'fg' | 'bg'; screen: 'on' | 'off' }; coverageMs: number; levelDeltaPct: number | null }>();

  for (let i = 0; i + 1 < samples.length; i++) {
    const a = samples[i];
    const b = samples[i + 1];
    if (b.reason === 'reset') continue;
    if (options.sinceWallMs !== undefined && a.wallMs < options.sinceWallMs) continue;

    if (!sameEpoch(a, b)) {
      flags.gaps += 1;
      const sameBoot = a.epoch.boot === b.epoch.boot;
      // Monotonic time is comparable only inside one boot; across a reboot only the wall clock is left.
      uncoveredMs += Math.max(0, sameBoot ? b.elapsedMs - a.elapsedMs : b.wallMs - a.wallMs);
      continue;
    }

    const dt = b.elapsedMs - a.elapsedMs;
    if (dt < 0) { flags.counterReset += 1; continue; }
    if (Math.abs((b.wallMs - a.wallMs) - dt) > CLOCK_SKEW_TOLERANCE_MS) flags.clockAdjusted += 1;
    if (b.cnt.droppedSamples > a.cnt.droppedSamples) flags.coalesced += 1;

    if (a.ctx.app == null || a.ctx.screen == null) {
      uncoveredMs += dt;
      continue;
    }

    const charging = a.ctx.plugged !== 'none' || b.ctx.plugged !== 'none';
    const bucket = bucketFor(buckets, { app: a.ctx.app, screen: a.ctx.screen ? 'on' : 'off', charging });
    bucket.durationMs += dt;
    bucket.windowCount += 1;
    coveredMs += dt;
    windowCount += 1;
    if (a.ctx.service) bucket.serviceMs += dt;
    if (a.ctx.doze) bucket.dozeMs += dt;

    let reset = false;
    const take = (d: Delta) => { reset = reset || d.reset; return d.value; };
    bucket.cpuMs = addNullable(bucket.cpuMs, take(delta(a.app.cpuMs, b.app.cpuMs)));
    bucket.rxBytes = addNullable(bucket.rxBytes, take(delta(a.app.rxBytes, b.app.rxBytes)));
    bucket.txBytes = addNullable(bucket.txBytes, take(delta(a.app.txBytes, b.app.txBytes)));
    bucket.wakeMs = addNullable(bucket.wakeMs, take(delta(a.app.health?.wakeMs, b.app.health?.wakeMs)));
    for (const [type, count] of Object.entries(b.cnt.engineEvents)) {
      const d = take(delta(a.cnt.engineEvents[type] ?? 0, count));
      if (d !== null) bucket.engineEvents[type] = (bucket.engineEvents[type] ?? 0) + d;
    }
    if (reset) flags.counterReset += 1;

    if (charging) continue;
    coverageMs += dt;
    const levelValue = a.dev.levelPct != null && b.dev.levelPct != null ? b.dev.levelPct - a.dev.levelPct : null;
    const charge = a.dev.chargeUah != null && b.dev.chargeUah != null ? b.dev.chargeUah - a.dev.chargeUah : null;
    const energy = a.dev.energyNwh != null && b.dev.energyNwh != null ? b.dev.energyNwh - a.dev.energyNwh : null;
    if (levelValue !== null || charge !== null || energy !== null) sawDeviceValue = true;
    levelDelta = addNullable(levelDelta, levelValue);
    chargeDelta = addNullable(chargeDelta, charge);
    energyDelta = addNullable(energyDelta, energy);
    const stateId = `${a.ctx.app}/${a.ctx.screen}`;
    const state = byState.get(stateId) ?? { key: { app: a.ctx.app, screen: a.ctx.screen ? 'on' as const : 'off' as const }, coverageMs: 0, levelDeltaPct: null };
    state.coverageMs += dt;
    state.levelDeltaPct = addNullable(state.levelDeltaPct, levelValue);
    byState.set(stateId, state);
  }

  const device: DeviceBattery = { scope: 'device', status: 'insufficient', coverageMs, levelDeltaPct: levelDelta, chargeDeltaUah: chargeDelta, energyDeltaNwh: energyDelta, levelRatePctPerHour: null };
  if (coverageMs > 0 && !sawDeviceValue) device.status = 'unavailable';
  else if (coverageMs < MIN_DISCHARGE_COVERAGE_MS) device.status = 'insufficient';
  else if (chargeDelta === 0 && levelDelta !== null && levelDelta <= -SUSPECT_LEVEL_DROP_PCT) device.status = 'suspect';
  else device.status = 'valid';
  if ((device.status === 'valid' || device.status === 'suspect') && levelDelta !== null) {
    device.levelRatePctPerHour = levelDelta / (coverageMs / 3_600_000);
  }

  const lastPerEpoch = new Map<string, PowerSample>();
  for (const s of samples) lastPerEpoch.set(`${s.epoch.boot}/${s.epoch.procStartElapsedMs}/${s.epoch.pid}`, s);
  const selfTotal = { samples: 0, costUs: 0, cpuUs: 0, binderCalls: 0 };
  for (const s of lastPerEpoch.values()) {
    selfTotal.samples += s.self.samples;
    selfTotal.costUs += s.self.costUs;
    selfTotal.cpuUs += s.self.cpuUs;
    selfTotal.binderCalls += s.self.binderCalls;
  }
  const self = lastPerEpoch.size > 0 ? selfTotal : null;

  return {
    buckets: [...buckets.values()], coveredMs, uncoveredMs, windowCount, flags, device,
    deviceByState: [...byState.values()].map(({ key, coverageMs: c, levelDeltaPct }) => ({ key, coverageMs: c, levelDeltaPct })),
    malformed: options.malformed ?? 0,
    retention: { truncated: samples.some((s) => s.trunc), sampleCount: samples.length },
    self,
    prevExits: samples.filter((s) => s.prevExit && (options.sinceWallMs === undefined || s.wallMs >= options.sinceWallMs))
      .map((s) => ({ reason: s.prevExit!.reason, timestampMs: s.prevExit!.timestampMs })),
    appEnergy: 'unavailable',
  };
}
