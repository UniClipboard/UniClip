import { aggregatePowerSamples, parsePowerSamples } from './aggregatePowerSamples';
import type { PowerSample } from './types';

const MIN = 60_000;
let seq = 0;

/** Discharging, screen off, background, one process, one boot — each test overrides what it exercises. */
function sample(atMin: number, over: Partial<PowerSample> & { patch?: (s: PowerSample) => void } = {}): PowerSample {
  const { patch, ...rest } = over;
  const s: PowerSample = {
    v: 1, seq: seq++, reason: 'query',
    wallMs: 1_700_000_000_000 + atMin * MIN, elapsedMs: 10_000_000 + atMin * MIN, uptimeMs: 5_000_000 + atMin * MIN,
    epoch: { boot: 7, procStartElapsedMs: 9_000_000, pid: 100 },
    ctx: { app: 'bg', importance: 400, screen: false, plugged: 'none', doze: false, powerSave: false,
      service: true, engine: true, net: 'wifi', bucket: 10, bgRestricted: false },
    dev: { levelPct: 80, chargeUah: 4_000_000, energyNwh: null, currentNowUa: null, currentAvgUa: null },
    app: { cpuMs: atMin * 100, rxBytes: atMin * 1000, txBytes: atMin * 500,
      health: { wakeMs: atMin * 10, cpuUserMs: null, cpuSysMs: null, radioMs: null } },
    cnt: { engineEvents: { incomingEntry: atMin }, droppedSamples: 0 },
    self: { samples: 1, costUs: 100, cpuUs: 50, binderCalls: 8 },
    ...rest,
  };
  patch?.(s);
  return s;
}

describe('aggregatePowerSamples', () => {
  beforeEach(() => { seq = 0; });

  it('attributes a quiet background screen-off window to its own bucket and does not call it app energy', () => {
    const out = aggregatePowerSamples([sample(0), sample(60, { dev: { levelPct: 78, chargeUah: 3_900_000, energyNwh: null, currentNowUa: null, currentAvgUa: null } })]);
    const b = out.buckets.find((x) => x.key.app === 'bg' && x.key.screen === 'off' && !x.key.charging)!;
    expect(b.durationMs).toBe(60 * MIN);
    expect(b.cpuMs).toBe(6000);
    expect(b.rxBytes).toBe(60_000);
    expect(b.wakeMs).toBe(600);
    expect(b.engineEvents.incomingEntry).toBe(60);
    expect(out.device.scope).toBe('device');
    expect(out.device.chargeDeltaUah).toBe(-100_000);
    expect(out.device.levelDeltaPct).toBe(-2);
    expect(out.appEnergy).toBe('unavailable');
  });

  it('measures duration with elapsed time when the wall clock jumps back', () => {
    const out = aggregatePowerSamples([sample(0), sample(30, { wallMs: 1_700_000_000_000 - 3_600_000 })]);
    expect(out.coveredMs).toBe(30 * MIN);
    expect(out.flags.clockAdjusted).toBe(1);
  });

  it('never differences process counters across a process restart and reports the gap as uncovered', () => {
    const out = aggregatePowerSamples([
      sample(0),
      sample(10),
      sample(50, { reason: 'process.start', epoch: { boot: 7, procStartElapsedMs: 10_000_000 + 49 * MIN, pid: 200 },
        app: { cpuMs: 40, rxBytes: 50_000, txBytes: 25_000, health: null }, cnt: { engineEvents: {}, droppedSamples: 0 },
        prevExit: { reason: 'lowMemory', importance: 400, timestampMs: 1 } }),
      sample(60, { epoch: { boot: 7, procStartElapsedMs: 10_000_000 + 49 * MIN, pid: 200 },
        app: { cpuMs: 140, rxBytes: 60_000, txBytes: 30_000, health: null }, cnt: { engineEvents: {}, droppedSamples: 0 } }),
    ]);
    expect(out.uncoveredMs).toBe(40 * MIN);
    expect(out.flags.gaps).toBe(1);
    const totalCpu = out.buckets.reduce((n, b) => n + (b.cpuMs ?? 0), 0);
    expect(totalCpu).toBe(1000 + 100);
    expect(out.prevExits).toEqual([{ reason: 'lowMemory', timestampMs: 1 }]);
  });

  it('does not difference uid or device counters across a reboot', () => {
    const out = aggregatePowerSamples([
      sample(0),
      sample(20, { epoch: { boot: 8, procStartElapsedMs: 10_000_000 + 19 * MIN, pid: 300 }, reason: 'process.start',
        app: { cpuMs: 10, rxBytes: 5, txBytes: 5, health: null } }),
    ]);
    expect(out.flags.gaps).toBe(1);
    expect(out.device.chargeDeltaUah).toBeNull();
  });

  it('excludes only the counter that went backwards and flags the window', () => {
    const out = aggregatePowerSamples([sample(5), sample(10, { patch: (s) => { s.app.cpuMs = 0; } })]);
    const b = out.buckets[0];
    expect(b.cpuMs).toBeNull();
    expect(b.rxBytes).toBe(5_000);
    expect(out.flags.counterReset).toBe(1);
  });

  it('reports unavailable rather than zero when no battery source exists', () => {
    const none = { levelPct: null, chargeUah: null, energyNwh: null, currentNowUa: null, currentAvgUa: null };
    const out = aggregatePowerSamples([sample(0, { dev: none }), sample(60, { dev: none })]);
    expect(out.device.status).toBe('unavailable');
    expect(out.device.chargeDeltaUah).toBeNull();
    expect(out.device.levelDeltaPct).toBeNull();
    expect(out.device.levelRatePctPerHour).toBeNull();
  });

  it('keeps charging windows out of the discharge numbers but still counts app activity', () => {
    const out = aggregatePowerSamples([
      sample(0),
      sample(60, { ctx: { ...sample(0).ctx, plugged: 'usb' }, dev: { levelPct: 90, chargeUah: 4_500_000, energyNwh: null, currentNowUa: null, currentAvgUa: null } }),
    ]);
    expect(out.device.coverageMs).toBe(0);
    expect(out.device.levelDeltaPct).toBeNull();
    const charging = out.buckets.find((b) => b.key.charging)!;
    expect(charging.cpuMs).toBe(6000);
  });

  it('calls a short or coarse discharge window insufficient, not zero', () => {
    const out = aggregatePowerSamples([sample(0), sample(5)]);
    expect(out.device.status).toBe('insufficient');
    expect(out.device.levelRatePctPerHour).toBeNull();
  });

  it('marks a charge counter that stays flat while the level falls as suspect', () => {
    const out = aggregatePowerSamples([
      sample(0),
      sample(120, { dev: { levelPct: 76, chargeUah: 4_000_000, energyNwh: null, currentNowUa: null, currentAvgUa: null } }),
    ]);
    expect(out.device.status).toBe('suspect');
    expect(out.device.levelDeltaPct).toBe(-4);
    expect(out.device.levelRatePctPerHour).toBeCloseTo(-2, 5);
  });

  it('flags windows where samples were dropped by the rate limit', () => {
    const out = aggregatePowerSamples([sample(0), sample(1, { cnt: { engineEvents: { incomingEntry: 1 }, droppedSamples: 4 } })]);
    expect(out.flags.coalesced).toBe(1);
  });

  it('does not let a window span a reset marker', () => {
    const out = aggregatePowerSamples([sample(0), sample(100, { reason: 'reset' }), sample(110)]);
    expect(out.coveredMs).toBe(10 * MIN);
    expect(out.uncoveredMs).toBe(0);
  });

  it('keeps only windows inside the requested period', () => {
    const out = aggregatePowerSamples([sample(0), sample(60), sample(120)], { sinceWallMs: 1_700_000_000_000 + 60 * MIN });
    expect(out.coveredMs).toBe(60 * MIN);
  });

  it('flags retention truncation and reports the monitor self cost', () => {
    const out = aggregatePowerSamples([sample(0, { trunc: true }), sample(10)]);
    expect(out.retention.truncated).toBe(true);
    expect(out.self).toEqual({ samples: 1, costUs: 100, cpuUs: 50, binderCalls: 8 });
  });

  it('counts foreground-service running time and doze time from the window context', () => {
    const out = aggregatePowerSamples([
      sample(0, { ctx: { ...sample(0).ctx, service: true, doze: true } }),
      sample(30),
    ]);
    expect(out.buckets[0].serviceMs).toBe(30 * MIN);
    expect(out.buckets[0].dozeMs).toBe(30 * MIN);
  });
});

describe('parsePowerSamples', () => {
  it('keeps good lines, counts bad and truncated lines, and ignores unknown schema versions', () => {
    const good = JSON.stringify(sample(0));
    const future = JSON.stringify({ ...sample(1), v: 2 });
    const parsed = parsePowerSamples(`${good}\nnot json\n${future}\n{"v":1,"seq":`);
    expect(parsed.samples).toHaveLength(1);
    expect(parsed.malformed).toBe(3);
  });
});
