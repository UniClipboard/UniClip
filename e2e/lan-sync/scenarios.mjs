// Desktop → phone LAN scenarios. Each states intended behaviour as assertions, so a run against
// an older APK records which signals fail there. `c` is the context built by run.mjs.
import { clockOffset } from "./timeline.mjs";

// RFC 5737 documentation addresses, dropped inside the owned emulator: connects stay in SYN-SENT.
export const BLACKHOLES = ["192.0.2.10", "198.51.100.10"];
const TARGET_MS = 500;
const APPLY_TIMEOUT_MS = 45_000;

const realUrl = (c) => `http://10.0.2.2:${c.port}`;
const holeUrl = (index) => `http://${BLACKHOLES[index]}:${42720 + index}`;
const badUrl = (c, name) => `http://10.0.2.2:${c.badPorts[name]}`;

/** Address orders the phone is configured with; the working address is never first by accident. */
const ORDERS = {
  "bad-first": (c) => [holeUrl(0), holeUrl(1), realUrl(c)],
  "bad-last": (c) => [realUrl(c), holeUrl(0), holeUrl(1)],
  "faulty-first": (c) => [badUrl(c, "unauthorized"), badUrl(c, "html"), realUrl(c)],
  "faulty-second": (c) => [badUrl(c, "truncated"), badUrl(c, "notFound"), realUrl(c)],
};

async function ensureServer(c, order) {
  if (c.configuredOrder === order) return;
  if (c.configuredOrder) {
    // A different address order is a new configuration: reinstall keeps runs independent.
    await c.probe.run("uninstall", c.appId);
    await c.probe.run("install", c.apkPath);
    c.onboarded = false;
  }
  if (!c.onboarded) {
    await c.runFlow("lifecycle/launch.yaml");
    await c.runFlow("actions/onboarding/complete.yaml");
    c.onboarded = true;
  }
  const urls = ORDERS[order](c);
  await c.runFlow("lan-scenarios/add-server.yaml", {
    URL_0: urls[0],
    URL_1: urls[1],
    URL_2: urls[2],
    LAN_USERNAME: c.phone.username,
    LAN_PASSWORD: c.phone.password,
  });
  c.configuredOrder = order;
  c.probe.event("lan.configured", { order, roles: urls.map((_, i) => `c${i}`) });
}

async function foreground(c) {
  await c.probe.shell(`am start -n ${c.appId}/app.uniclipboard.android.MainActivity`);
  await c.delay(1500);
}

/** Waits until the phone has completed one valid protected read, i.e. a warm session exists. */
async function waitWarm(c, sincePhoneWall, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const traces = await c.readTraces(sincePhoneWall);
    if (traces.some((t) => t.stage === "get_result" && t.valid === "true")) return true;
    await c.delay(1000);
  }
  return false;
}

/**
 * One desktop copy measured end to end. The desktop activation time is the peer's own
 * `server_time_ms` for this content id; the phone time is the clipboard write completion.
 */
export async function measureCopy(c, phase, seq, { timeoutMs = APPLY_TIMEOUT_MS, expectApplied = true } = {}) {
  const nonce = `UCLAN${c.runId}${phase.replace(/[^A-Za-z0-9]/g, "")}N${seq}`;
  const clock = await clockOffset(c.probe);
  const toHost = (phoneWall) => phoneWall - clock.offsetMs;
  const copy = await c.peer.copyText(nonce);
  const document = await c.observer.currentDocument();
  const sample = { phase, seq, ok: false, clockOffsetMs: clock.offsetMs, clockErrorMs: clock.errorMs };
  if (document.text !== nonce || !document.contentId) {
    c.samples.push({ ...sample, note: "peer did not expose the fixture" });
    return c.samples.at(-1);
  }
  const alias = c.contentAlias(document.contentId);
  sample.alias = alias;
  const update = await c.observer.waitForUpdate(document.contentId, 5000);
  const activation = update?.serverTimeMs ?? copy.restoreStartedAt;
  const since = copy.startedAt + clock.offsetMs - 3000;
  const deadline = Date.now() + timeoutMs;
  let traces = [];
  let applied;
  while (Date.now() < deadline) {
    traces = await c.readTraces(since);
    applied = traces.find((t) => t.stage === "clipboard_applied" && t.cid === alias);
    if (applied) break;
    await c.delay(expectApplied ? 250 : 1000);
  }
  const sse = traces.find((t) => t.stage === "sse_event" && t.type === "update" && t.cid === alias);
  const history = traces.find((t) => t.stage === "history_saved" && t.cid === alias);
  const window = traces.filter((t) => toHost(t.wall) >= activation && (!applied || t.wall <= applied.wall));
  Object.assign(sample, {
    ok: Boolean(applied),
    activationSource: update ? "peer-sse" : "restore-call",
    activationToAppliedMs: applied ? Math.round(toHost(applied.wall) - activation) : null,
    copyToAppliedMs: applied ? Math.round(toHost(applied.wall) - copy.restoreStartedAt) : null,
    activationToSseMs: sse ? Math.round(toHost(sse.wall) - activation) : null,
    sseToAppliedMs: sse && applied ? applied.wall - sse.wall : null,
    appliedToHistoryMs: history && applied ? history.wall - applied.wall : null,
    getAttempts: window.filter((t) => t.stage === "get_attempt").length,
    stages: window.map((t) => ({
      stage: t.stage,
      atMs: Math.round(toHost(t.wall) - activation),
      route: t.route,
      status: t.status,
      ms: t.ms ? Number(t.ms) : undefined,
      type: t.type,
    })),
  });
  if (!applied) sample.note = expectApplied ? "not applied within timeout" : "not applied (expected)";
  c.samples.push(sample);
  c.probe.event("copy.measured", { phase, seq, alias, ok: sample.ok, ms: sample.activationToAppliedMs });
  return sample;
}

/** The fixture app reads the OS clipboard in the foreground and logs only whether it matches. */
async function readbackMatches(c, nonce) {
  const since = Date.now() / 1000 - 1;
  await c.probe.shell(`am start -n test.clipboardfixture/.ReadActivity --es expect ${nonce}`);
  for (let i = 0; i < 20; i++) {
    await c.delay(500);
    const log = await c.probe.run("logcat", "-d", "-v", "epoch", "-s", "UcClipboardFixture:I").catch(() => "");
    const match = log
      .split("\n")
      .filter((line) => Number(line.match(/^\s*(\d+\.\d+)/)?.[1]) >= since)
      .map((line) => line.match(/read match=(true|false)/)?.[1])
      .find(Boolean);
    if (match) return match === "true";
  }
  return false;
}

async function phaseSamples(c, phase, before) {
  const results = [];
  for (let seq = 1; seq <= c.samplesPerPhase; seq++) {
    if (before) await before(seq);
    results.push(await measureCopy(c, phase, seq));
    await c.delay(1500 + Math.floor(Math.random() * 1000));
  }
  return results;
}

function judgePhase(c, scenario, phase, results) {
  const ok = results.filter((r) => r.ok);
  c.assert(`${phase}.all-applied`, scenario, ok.length === results.length, {
    applied: ok.length,
    samples: results.length,
  });
  const within = ok.filter((r) => r.activationToAppliedMs <= TARGET_MS).length;
  c.assert(`${phase}.within-${TARGET_MS}ms`, scenario, ok.length > 0 && within === results.length, {
    within,
    samples: results.length,
    maxMs: Math.max(...ok.map((r) => r.activationToAppliedMs)),
  });
  const extraAttempts = ok.filter((r) => r.getAttempts > 1).length;
  c.assert(`${phase}.single-read-per-copy`, scenario, extraAttempts === 0, { samplesWithExtraReads: extraAttempts });
}

async function assertNoEcho(c, scenario, phase, results) {
  // An applied desktop copy must not come back as an upload: the peer sees each content id activated once.
  await c.delay(3000);
  const ids = results.filter((r) => r.alias).map((r) => r.alias);
  const counts = ids.map((alias) => c.observer.updates.filter((u) => c.contentAlias(u.contentId) === alias).length);
  c.assert(`${phase}.no-echo-upload`, scenario, counts.every((n) => n === 1), { counts });
}

async function warmForeground(c, order) {
  const s = `foreground-${order}`;
  await ensureServer(c, order);
  await foreground(c);
  const warm = await waitWarm(c, 0);
  c.assert(`${s}.session-warm`, s, warm);
  const results = await phaseSamples(c, s);
  judgePhase(c, s, s, results);
  await assertNoEcho(c, s, s, results);
  const last = results.at(-1);
  if (last?.ok) {
    const nonce = `UCLAN${c.runId}${s.replace(/[^A-Za-z0-9]/g, "")}N${last.seq}`;
    c.assert(`${s}.clipboard-readback`, s, await readbackMatches(c, nonce));
    await foreground(c);
  }
}

export const SCENARIOS = {
  // Two unreachable addresses in front of the working one, app in the foreground (field shape).
  "foreground-bad-first": (c) => warmForeground(c, "bad-first"),
  // Working address first: the control for the address-selection cost.
  "foreground-bad-last": (c) => warmForeground(c, "bad-last"),

  // Reachable but wrong candidates in front: 401 with public health, HTML, truncated body, 404.
  async "faulty-candidates"(c) {
    for (const order of ["faulty-first", "faulty-second"]) {
      const s = `faulty-${order}`;
      await ensureServer(c, order);
      await foreground(c);
      c.assert(`${s}.session-warm`, "faulty-candidates", await waitWarm(c, 0));
      const results = [];
      for (let seq = 1; seq <= Math.min(3, c.samplesPerPhase); seq++) {
        results.push(await measureCopy(c, s, seq));
        await c.delay(1500);
      }
      c.assert(`${s}.all-applied`, "faulty-candidates", results.every((r) => r.ok), {
        applied: results.filter((r) => r.ok).length,
      });
    }
  },

  // Home pressed with background sync on; the copy must arrive without opening the app.
  async "background-bad-first"(c) {
    const s = "background-bad-first";
    await ensureServer(c, "bad-first");
    if (!c.backgroundEnabled) {
      await c.runFlow("network-scenarios/diagnostic-background-enable.yaml");
      c.backgroundEnabled = true;
    }
    await foreground(c);
    await waitWarm(c, 0);
    await c.act.home();
    await c.delay(5000);
    const service = await c.probe.sample(`${s}-after-home`);
    c.assert(`${s}.service-running`, s, Boolean(service.service.present && service.service.foreground), { service: service.service });
    const results = await phaseSamples(c, s);
    judgePhase(c, s, s, results);
    await assertNoEcho(c, s, s, results);
  },

  // Fresh process, first copy right after launch: reported apart from warm samples.
  async "cold-start"(c) {
    const s = "cold-start";
    await ensureServer(c, "bad-first");
    const results = [];
    for (let seq = 1; seq <= Math.min(5, c.samplesPerPhase); seq++) {
      await c.probe.shell(`am force-stop ${c.appId}`);
      await foreground(c);
      results.push(await measureCopy(c, s, seq));
    }
    c.assert(`${s}.all-applied`, s, results.every((r) => r.ok), { applied: results.filter((r) => r.ok).length });
  },

  // Wi-Fi drops and returns on the owned emulator; the next copy must recover.
  async "network-change"(c) {
    const s = "network-change";
    await ensureServer(c, "bad-first");
    await foreground(c);
    await waitWarm(c, 0);
    const results = [];
    for (let seq = 1; seq <= Math.min(3, c.samplesPerPhase); seq++) {
      await c.probe.shell("svc wifi disable");
      await c.delay(4000);
      await c.probe.shell("svc wifi enable");
      await c.delay(4000);
      results.push(await measureCopy(c, s, seq));
    }
    c.assert(`${s}.all-applied`, s, results.every((r) => r.ok), { applied: results.filter((r) => r.ok).length });
  },
};
