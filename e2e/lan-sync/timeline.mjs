// Phone-side LAN trace parsing, phone↔host clock offset and latency summaries.

/** Same FNV-1a alias as src/features/lan-sync/internal/lanSyncTrace.ts. */
export function contentAlias(contentId) {
  if (!contentId) return "none";
  let hash = 0x811c9dc5;
  for (let index = 0; index < contentId.length; index += 1) {
    hash ^= contentId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** `lan.trace` records from the app's JS log since a phone wall time (roles, aliases, timings only). */
export async function readTraces(probe, sincePhoneWallMs = 0) {
  const raw = await probe
    .run("logcat", "-d", "-v", "epoch", "-t", "60000", "ReactNativeJS:I", "*:S")
    .catch(() => "");
  const traces = [];
  for (const line of raw.split("\n")) {
    const body = line.match(/lan\.trace (.*)$/)?.[1];
    if (!body) continue;
    const record = {};
    for (const pair of body.trim().split(/\s+/)) {
      const at = pair.indexOf("=");
      if (at > 0) record[pair.slice(0, at)] = pair.slice(at + 1);
    }
    record.wall = Number(record.wall);
    record.mono = Number(record.mono);
    if (record.wall >= sincePhoneWallMs) traces.push(record);
  }
  // logcat may repeat nothing, but the asynchronous log writer can reorder; sort by the stage's own time.
  return traces.sort((a, b) => a.wall - b.wall || a.mono - b.mono);
}

/** Native overlay clipboard timing (`UcClipTiming`): stage, operation, phone wall time, counts. */
export async function readNativeTiming(probe, sincePhoneWallMs = 0) {
  const raw = await probe
    .run("logcat", "-d", "-v", "epoch", "-t", "60000", "UcClipTiming:I", "*:S")
    .catch(() => "");
  const records = [];
  for (const line of raw.split("\n")) {
    const body = line.match(/UcClipTiming:\s*(.*)$/)?.[1];
    if (!body) continue;
    const record = {};
    for (const pair of body.trim().split(/\s+/)) {
      const at = pair.indexOf("=");
      if (at > 0) record[pair.slice(0, at)] = pair.slice(at + 1);
    }
    record.wall = Number(record.wall);
    if (record.wall >= sincePhoneWallMs) records.push(record);
  }
  return records.sort((a, b) => a.wall - b.wall);
}

/**
 * Phone wall clock minus host wall clock, from the fastest of several adb round trips.
 * `errorMs` is half that round trip: the bound for this measurement, not for later drift.
 */
export async function clockOffset(probe, rounds = 7) {
  let best = null;
  for (let i = 0; i < rounds; i++) {
    const before = Date.now();
    const text = await probe.shell("echo $EPOCHREALTIME");
    const after = Date.now();
    const phone = Number(text.trim()) * 1000;
    const rtt = after - before;
    if (!Number.isFinite(phone)) continue;
    if (!best || rtt < best.rtt) best = { rtt, offsetMs: Math.round(phone - (before + after) / 2) };
  }
  if (!best) throw new Error("Could not read the phone clock");
  return { offsetMs: best.offsetMs, errorMs: Math.ceil(best.rtt / 2) };
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
}

export function distribution(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  return {
    n: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted.at(-1) ?? null,
    min: sorted[0] ?? null,
  };
}

/** Per phase: activation→clipboard (the 0.5 s target), plus stage splits. Failed samples count separately. */
export function summarize(samples) {
  const phases = {};
  for (const sample of samples) (phases[sample.phase] ??= []).push(sample);
  return Object.fromEntries(
    Object.entries(phases).map(([phase, list]) => {
      const ok = list.filter((s) => s.ok);
      return [
        phase,
        {
          sampleCount: list.length,
          applied: ok.length,
          failed: list.length - ok.length,
          activationToAppliedMs: distribution(ok.map((s) => s.activationToAppliedMs)),
          restoreRequestToAppliedMs: distribution(ok.map((s) => s.restoreRequestToAppliedMs)),
          activationToSseMs: distribution(ok.map((s) => s.activationToSseMs)),
          sseToAppliedMs: distribution(ok.map((s) => s.sseToAppliedMs)),
          withinTarget500Ms: ok.filter((s) => s.activationToAppliedMs <= 500).length,
          clockErrorMsMax: Math.max(0, ...list.map((s) => s.clockErrorMs ?? 0)),
        },
      ];
    })
  );
}
