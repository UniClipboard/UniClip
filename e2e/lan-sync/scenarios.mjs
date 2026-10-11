// Desktop → phone LAN scenarios. Each states intended behaviour as assertions, so a run against
// an older APK records which signals fail there. `c` is the context built by run.mjs.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { clockOffset, readNativeTiming } from "./timeline.mjs";
import { buildSegments } from "./segments.mjs";

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
  "legacy-host": (c) => [holeUrl(0), holeUrl(1), badUrl(c, "legacyHost")],
  "put-lost": (c) => [holeUrl(0), holeUrl(1), badUrl(c, "putResponseLost")],
};

async function ensureServer(c, order, { second = false } = {}) {
  // A second desktop left configured by an earlier scenario would also receive every upload.
  if (c.configuredOrder === order && (second || !c.secondConfigured)) return;
  if (c.configuredOrder) {
    // A different address order is a new configuration: reinstall keeps runs independent.
    await c.probe.run("uninstall", c.appId);
    await c.probe.run("install", c.apkPath);
    c.onboarded = false;
    c.secondConfigured = false;
    c.backgroundEnabled = false;
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
    SERVER_COUNT: 1,
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
export async function measureCopy(
  c,
  phase,
  seq,
  { timeoutMs = APPLY_TIMEOUT_MS, expectApplied = true, via = { peer: c.peer, observer: c.observer } } = {}
) {
  const { peer, observer } = via;
  const nonce = `UCLAN${c.runId}${phase.replace(/[^A-Za-z0-9]/g, "")}N${seq}`;
  const clock = await clockOffset(c.probe);
  const toHost = (phoneWall) => phoneWall - clock.offsetMs;
  const copy = await peer.copyText(nonce);
  const sample = { phase, seq, ok: false, clockOffsetMs: clock.offsetMs, clockErrorMs: clock.errorMs };
  // The announcement carries the content id; the harness reads the document itself only after the
  // phone is done, so the listener log holds the phone's request alone during the measurement.
  const update = await observer.waitForUpdateAfter(copy.restoreStartedAt, 5000);
  if (!update) {
    c.samples.push({ ...sample, note: "peer did not announce the fixture" });
    return c.samples.at(-1);
  }
  const alias = c.contentAlias(update.contentId);
  sample.alias = alias;
  const activation = update.serverTimeMs;
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
  if (applied) {
    // History and display commit follow the clipboard; give them a moment to be recorded.
    for (let i = 0; i < 12 && !traces.some((t) => t.stage === "ui_committed" && t.cid === alias); i++) {
      await c.delay(250);
      traces = await c.readTraces(since);
    }
  }
  const document = await observer.currentDocument();
  if (document.contentId !== update.contentId || document.text !== nonce) sample.note = "announced content is not this fixture";
  const sse = traces.find((t) => t.stage === "sse_event" && t.type === "update" && t.cid === alias);
  const history = traces.find((t) => t.stage === "history_saved" && t.cid === alias);
  const window = traces.filter((t) => toHost(t.wall) >= activation && (!applied || t.wall <= applied.wall));
  const native = await readNativeTiming(c.probe, since);
  const desktop = await peer.mobileLanTimeline(copy.restoreStartedAt - 1000);
  Object.assign(sample, {
    ok: Boolean(applied),
    activationSource: "peer-sse",
    activationToAppliedMs: applied ? Math.round(toHost(applied.wall) - activation) : null,
    restoreRequestToAppliedMs: applied ? Math.round(toHost(applied.wall) - copy.restoreStartedAt) : null,
    activationToSseMs: sse ? Math.round(toHost(sse.wall) - activation) : null,
    sseToAppliedMs: sse && applied ? applied.wall - sse.wall : null,
    appliedToHistoryMs: history && applied ? history.wall - applied.wall : null,
    getAttempts: window.filter((t) => t.stage === "get_attempt").length,
    segments: buildSegments({
      traces,
      native,
      desktop,
      alias,
      activation,
      observerReceived: update.hostReceivedMs,
      offset: clock.offsetMs,
    }),
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
  return (await readClipboardBack(c, nonce)).match;
}

/** Whether the OS clipboard equals `nonce`, and whether the reader could see any clip at all. */
async function readClipboardBack(c, nonce) {
  const since = Date.now() / 1000 - 1;
  await c.probe.shell(`am start -n test.clipboardfixture/.ReadActivity --es expect ${nonce}`);
  for (let i = 0; i < 20; i++) {
    await c.delay(500);
    const log = await c.probe.run("logcat", "-d", "-v", "epoch", "-s", "UcClipboardFixture:I").catch(() => "");
    const line = log
      .split("\n")
      .filter((l) => Number(l.match(/^\s*(\d+\.\d+)/)?.[1]) >= since)
      .find((l) => /read match=/.test(l));
    if (line) return { match: /match=true/.test(line), present: /present=true/.test(line) };
  }
  return { match: false, present: null };
}

async function phaseSamples(c, phase, before, { readback = false } = {}) {
  const results = [];
  for (let seq = 1; seq <= c.samplesPerPhase; seq++) {
    if (before) await before(seq);
    const putsBefore = await c.peer.mobileLanRequests("PUT", "/SyncClipboard.json");
    const sample = await measureCopy(c, phase, seq);
    if (readback && sample.ok) {
      // The fixture app reads the OS clipboard in the foreground and finishes; the app stays in the
      // background. Only proves the content is pasteable, not when it became so.
      const result = await readClipboardBack(c, `UCLAN${c.runId}${phase.replace(/[^A-Za-z0-9]/g, "")}N${seq}`);
      sample.clipboardReadback = result.match;
      sample.readbackSawClip = result.present;
      await c.act.home();
    }
    await c.delay(1500 + Math.floor(Math.random() * 1000));
    sample.desktopPutsAfter = (await c.peer.mobileLanRequests("PUT", "/SyncClipboard.json")) - putsBefore;
    if (sample.desktopPutsAfter > 0) {
      // Keep what explains an upload during a desktop-to-phone sample: phone stages (roles and
      // aliases only) and the clipboard observer's own log tags.
      const since = Date.now() - 20_000;
      const clock = await clockOffset(c.probe);
      const traces = await c.readTraces(since + clock.offsetMs);
      sample.echoDiagnostics = {
        stages: traces.map((t) => ({ stage: t.stage, wall: t.wall, cid: t.cid, route: t.route, status: t.status })),
        observer: await c.probe.clipboardLogs(since),
      };
    }
    results.push(sample);
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

async function assertNoEcho(c, scenario, phase, results, putsBefore) {
  // An applied desktop copy must not come back as an upload: no phone PUT reaches the desktop.
  await c.delay(3000);
  const puts = (await c.peer.mobileLanRequests("PUT", "/SyncClipboard.json")) - putsBefore;
  const ids = results.filter((r) => r.alias).map((r) => r.alias);
  const announcements = ids.map((alias) => c.observer.updates.filter((u) => c.contentAlias(u.contentId) === alias).length);
  c.assert(`${phase}.no-echo-upload`, scenario, puts === 0, { desktopPuts: puts, announcements });
}

/** Echo suppressions the phone recorded since a phone wall time (proves an observed read-back). */
async function suppressedSince(c, sincePhoneWall) {
  return (await c.readTraces(sincePhoneWall)).filter((t) => t.stage === "observe_suppressed").length;
}

async function warmForeground(c, order) {
  const s = `foreground-${order}`;
  await ensureServer(c, order);
  await foreground(c);
  const warm = await waitWarm(c, 0);
  c.assert(`${s}.session-warm`, s, warm);
  const putsBefore = await c.peer.mobileLanRequests("PUT", "/SyncClipboard.json");
  const results = await phaseSamples(c, s, () => foreground(c), { readback: true });
  judgePhase(c, s, s, results);
  c.assert(`${s}.clipboard-readback-each`, s, results.every((r) => r.clipboardReadback === true), {
    readback: results.map((r) => [r.clipboardReadback ?? null, r.readbackSawClip ?? null]),
  });
  await assertNoEcho(c, s, s, results, putsBefore);
  c.assert(`${s}.notified-by-sse`, s, results.every((r) => r.activationToSseMs !== null), {
    withSse: results.filter((r) => r.activationToSseMs !== null).length,
  });
  const last = results.at(-1);
  if (last?.ok) {
    const nonce = `UCLAN${c.runId}${s.replace(/[^A-Za-z0-9]/g, "")}N${last.seq}`;
    c.assert(`${s}.clipboard-readback`, s, await readbackMatches(c, nonce));
    await foreground(c);
  }
}

/** A small PNG whose pixels are derived from `seed`, so every run shares content the desktop has not seen. */
function syntheticPng(seed) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let v = n;
    for (let k = 0; k < 8; k++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1;
    return v >>> 0;
  });
  const crc = (buf) => {
    let v = 0xffffffff;
    for (const byte of buf) v = crcTable[(v ^ byte) & 0xff] ^ (v >>> 8);
    return (v ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const size = 48;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = [0];
    for (let x = 0; x < size; x++) row.push((x * 5 + seed.charCodeAt(x % seed.length)) & 255, (y * 5) & 255, seed.charCodeAt(y % seed.length) & 255);
    rows.push(Buffer.from(row));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Puts a synthetic photo in the emulator's media store and returns its content URI. */
async function mediaImage(c, name) {
  const local = join(c.output, `${name}.png`);
  await writeFile(local, syntheticPng(name));
  const remote = `/sdcard/Pictures/${name}.png`;
  await c.probe.run("push", local, remote);
  await c.probe.shell(`am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file://${remote}`);
  for (let i = 0; i < 20; i++) {
    const rows = await c.probe
      .shell(`content query --uri content://media/external/images/media --projection _id --where "_display_name='${name}.png'"`)
      .catch(() => "");
    const id = rows.match(/_id=(\d+)/)?.[1];
    if (id) return `content://media/external/images/media/${id}`;
    await c.delay(500);
  }
  throw new Error("The synthetic photo did not reach the media store");
}

/** Shares a photo to the app as the system share sheet would, then sends it from the app's sheet. */
async function sharePhoto(c, uri) {
  await c.probe.shell(
    `am start -a android.intent.action.SEND -t image/png --eu android.intent.extra.STREAM ${uri} --grant-read-uri-permission -n ${c.appId}/app.uniclipboard.android.MainActivity`
  );
  // Opening the app starts a pull; let it finish, as a person reading the sheet would.
  await c.delay(4000);
  await c.runFlow("lan-scenarios/share-send.yaml");
}

/** Adds a second desktop as a second LAN server, through the same settings UI as the first. */
async function ensureSecondDesktop(c) {
  c.second ??= await c.addPeer("b");
  if (c.secondConfigured) return c.second;
  await c.runFlow("lan-scenarios/add-server.yaml", {
    URL_0: holeUrl(0),
    URL_1: holeUrl(1),
    URL_2: `http://10.0.2.2:${c.second.port}`,
    LAN_USERNAME: c.second.phone.username,
    LAN_PASSWORD: c.second.phone.password,
    SERVER_COUNT: 2,
  });
  c.secondConfigured = true;
  c.probe.event("lan.second-configured", { roles: ["c0", "c1", "c2"] });
  return c.second;
}

async function waitDocument(observer, predicate, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let document = null;
  while (Date.now() < deadline) {
    document = await observer.currentDocument().catch(() => null);
    if (document && predicate(document)) return document;
    await new Promise((done) => setTimeout(done, 500));
  }
  return null;
}

/** Shares a photo; a failed send leaves the sheet open with "Retry", which is dismissed unsent. */
async function sharePhotoTolerant(c, uri) {
  try {
    await sharePhoto(c, uri);
    return true;
  } catch {
    await c.probe.shell("input keyevent KEYCODE_BACK");
    await c.delay(1000);
    return false;
  }
}

/** Desktop-side request counts, the phone's write traces and the proxy's connection log since a point. */
async function writeEvidence(c, before, since, proxyFrom) {
  const traces = await c.readTraces(since);
  return {
    desktopDocumentPuts: (await c.peer.mobileLanRequests("PUT", "/SyncClipboard.json")) - before.documents,
    desktopPayloadPuts: (await c.peer.mobileLanRequests("PUT", "/file/*")) - before.payloads,
    phonePutAttempts: traces.filter((t) => t.stage === "put_attempt").length,
    phonePutResults: traces.filter((t) => t.stage === "put_result").map((t) => t.status),
    writePath: [...new Set(traces.filter((t) => t.stage === "put_attempt").map((t) => t.transport ?? "not-traced"))],
    proxyPuts: c.bad.putLostLog
      .slice(proxyFrom)
      .filter((r) => r.method === "PUT")
      .map(({ kind, socket, requestOnSocket, userAgent, chunked }) => ({ kind, socket, requestOnSocket, userAgent, chunked })),
  };
}

async function writeBaseline(c) {
  return {
    documents: await c.peer.mobileLanRequests("PUT", "/SyncClipboard.json"),
    payloads: await c.peer.mobileLanRequests("PUT", "/file/*"),
  };
}

export const SCENARIOS = {

  // Upload replies lost on a reused or a fresh connection, for a text copy and for a shared photo
  // (reply lost on the payload, or on the document after it), measured by what the desktop
  // actually received. Then normal writes after an idle connection was closed, and a legitimate
  // A, B, A repeat, must each arrive exactly as often as the user copied.
  async "put-lost-matrix"(c) {
    const s = "put-lost-matrix";
    await ensureServer(c, "put-lost");
    if (!c.backgroundEnabled) {
      await c.runFlow("lan-scenarios/enable-background.yaml");
      c.backgroundEnabled = true;
    }
    await foreground(c);
    c.assert(`${s}.session-warm`, s, await waitWarm(c, 0));
    // A failed upload backs the address off: start each case after a successful read.
    const readAgain = async () => {
      const clock = await clockOffset(c.probe);
      return waitWarm(c, Date.now() + clock.offsetMs, 30_000);
    };
    const textCase = async (name, control, { expectDelivered }) => {
      c.bad.setPutLost(control);
      // A read in the foreground leaves a pooled connection to the proxy (unless fresh). The copy
      // is then uploaded from the background, where no other request is using that connection.
      await foreground(c);
      const warm = await readAgain();
      await c.act.home();
      await c.delay(3000);
      const before = await writeBaseline(c);
      const proxyFrom = c.bad.putLostLog.length;
      const clock = await clockOffset(c.probe);
      const since = Date.now() + clock.offsetMs;
      const nonce = `UCLAN${c.runId}${name.replace(/[^A-Za-z0-9]/g, "")}`;
      await c.act.copyInOtherApp(nonce);
      await c.delay(15_000);
      const evidence = { warm, ...(await writeEvidence(c, before, since, proxyFrom)) };
      await foreground(c);
      const document = await c.observer.currentDocument();
      c.assert(`${s}.${name}.desktop-received-once`, s, evidence.desktopDocumentPuts === 1 && document.text === nonce, evidence);
      c.assert(`${s}.${name}.one-phone-attempt`, s, evidence.phonePutAttempts === 1, evidence);
      c.assert(
        `${s}.${name}.result`,
        s,
        expectDelivered ? evidence.phonePutResults.includes("200") : evidence.phonePutResults.includes("unknown"),
        { results: evidence.phonePutResults }
      );
      return nonce;
    };
    await textCase("text-reused", { drop: "document", fresh: false, keepAliveMs: 60_000 }, { expectDelivered: false });
    await textCase("text-fresh", { drop: "document", fresh: true, keepAliveMs: 60_000 }, { expectDelivered: false });

    for (const [name, drop] of [
      ["photo-payload-reused", "payload"],
      ["photo-document-reused", "document"],
    ]) {
      c.bad.setPutLost({ drop, fresh: false, keepAliveMs: 60_000 });
      const uri = await mediaImage(c, `ucshare${c.runId}${name.replace(/[^A-Za-z0-9]/g, "")}`);
      await foreground(c);
      const warm = await readAgain();
      c.probe.event("put-lost.case", { name, warm });
      const before = await writeBaseline(c);
      const proxyFrom = c.bad.putLostLog.length;
      const clock = await clockOffset(c.probe);
      const since = Date.now() + clock.offsetMs;
      const sheetClosed = await sharePhotoTolerant(c, uri);
      await c.delay(10_000);
      const evidence = await writeEvidence(c, before, since, proxyFrom);
      c.assert(`${s}.${name}.payload-received-once`, s, evidence.desktopPayloadPuts === 1, { ...evidence, sheetClosed });
      c.assert(
        `${s}.${name}.document-count`,
        s,
        evidence.desktopDocumentPuts === (drop === "payload" ? 0 : 1),
        { ...evidence, sheetClosed }
      );
      c.assert(`${s}.${name}.one-phone-attempt`, s, evidence.phonePutAttempts === 1, evidence);
      await foreground(c);
    }

    // The proxy drops idle connections after one second: the next write must still arrive once.
    // (The copy follows the pull by several seconds, so the pooled connection is already closed.)
    await textCase("idle-closed", { drop: "none", fresh: false, keepAliveMs: 1000 }, { expectDelivered: true });
    c.bad.setPutLost({ drop: "none", fresh: false, keepAliveMs: 60_000 });
    const before = await writeBaseline(c);
    const sequence = ["A", "B", "A"].map((x) => `UCLAN${c.runId}repeat${x}`);
    for (const text of sequence) {
      await c.act.copyInOtherApp(text);
      await foreground(c);
      await waitDocument(c.observer, (d) => d.text === text, 15_000);
      await c.delay(2000);
    }
    const puts = (await c.peer.mobileLanRequests("PUT", "/SyncClipboard.json")) - before.documents;
    const last = await c.observer.currentDocument();
    c.assert(`${s}.repeat-aba-each-sent`, s, puts === 3 && last.text === sequence[2], { desktopPuts: puts });
  },

  // A photo shared from the phone reaches the desktop, and the desktop's announcement of that same
  // photo (re-encoded, so a different hash) is not downloaded and written back to the phone. A
  // second share of the same photo takes the desktop's duplicate path. A real desktop copy right
  // afterwards must still be applied.
  async "share-photo-echo"(c) {
    const s = "share-photo-echo";
    await ensureServer(c, "bad-first");
    await foreground(c);
    await waitWarm(c, 0);
    const uri = await mediaImage(c, `ucshare${c.runId}`);
    for (const round of ["first", "again"]) {
      const clock = await clockOffset(c.probe);
      const since = Date.now() + clock.offsetMs;
      const sharedAt = Date.now();
      await sharePhoto(c, uri);
      const document = await waitDocument(c.observer, (d) => d.type === "Image");
      c.assert(`${s}.${round}.desktop-received`, s, Boolean(document), { type: document?.type ?? null });
      // Long enough for the announcement, a pull and a payload download had it been applied.
      await c.delay(10_000);
      const traces = await c.readTraces(since);
      const puts = traces.filter((t) => t.stage === "put_attempt" && t.payload === "true");
      const announced = c.observer.updates.filter((u) => u.hostReceivedMs >= sharedAt).map((u) => c.contentAlias(u.contentId));
      const applied = traces.filter((t) => t.stage === "apply_start");
      c.assert(`${s}.${round}.uploaded`, s, puts.length === 1, { puts: puts.length });
      c.assert(`${s}.${round}.not-applied-back`, s, applied.length === 0, {
        applied: applied.map((t) => t.cid),
        announced,
        pulledNew: traces.filter((t) => t.stage === "remote_new").map((t) => t.cid),
        ack: traces.filter((t) => t.stage === "put_result").map((t) => t.ack ?? "not-traced"),
      });
      await foreground(c);
    }
    const after = await measureCopy(c, `${s}-desktop-copy`, 1);
    c.assert(`${s}.desktop-copy-still-applied`, s, after.ok);
  },

  // Two different desktops configured as two servers: each one's copies reach the phone, in the
  // foreground and in the background, and a phone copy reaches both.
  async "second-desktop"(c) {
    const s = "second-desktop";
    await ensureServer(c, "bad-first", { second: true });
    const b = await ensureSecondDesktop(c);
    await foreground(c);
    await waitWarm(c, 0);
    const n = Math.min(3, c.samplesPerPhase);
    for (const [name, via] of [
      ["b", { peer: b.peer, observer: b.observer }],
      ["a", { peer: c.peer, observer: c.observer }],
    ]) {
      const results = [];
      for (let seq = 1; seq <= n; seq++) {
        results.push(await measureCopy(c, `${s}-fg-${name}`, seq, { via, timeoutMs: 20_000 }));
        await c.delay(1000);
      }
      c.assert(`${s}.foreground.${name}-applied`, s, results.every((r) => r.ok), {
        applied: results.filter((r) => r.ok).length,
        of: results.length,
      });
    }
    const nonce = `UCLAN${c.runId}twoN1`;
    const putsBefore = await Promise.all([c.peer, b.peer].map((p) => p.mobileLanRequests("PUT", "/SyncClipboard.json")));
    await c.act.copyInOtherApp(nonce);
    await foreground(c);
    const [toA, toB] = await Promise.all([
      waitDocument(c.observer, (d) => d.text === nonce),
      waitDocument(b.observer, (d) => d.text === nonce),
    ]);
    c.assert(`${s}.phone-copy-reaches-both`, s, Boolean(toA && toB), { a: Boolean(toA), b: Boolean(toB) });
    await c.delay(3000);
    const putsAfter = await Promise.all([c.peer, b.peer].map((p) => p.mobileLanRequests("PUT", "/SyncClipboard.json")));
    const each = putsAfter.map((n, i) => n - putsBefore[i]);
    c.assert(`${s}.phone-copy-once-per-desktop`, s, each.every((n) => n === 1), { a: each[0], b: each[1] });
    if (!c.backgroundEnabled) {
      await c.runFlow("lan-scenarios/enable-background.yaml");
      c.backgroundEnabled = true;
    }
    await foreground(c);
    await c.act.home();
    await c.delay(5000);
    for (const [name, via] of [
      ["b", { peer: b.peer, observer: b.observer }],
      ["a", { peer: c.peer, observer: c.observer }],
    ]) {
      const sample = await measureCopy(c, `${s}-bg-${name}`, 1, { via, timeoutMs: 20_000 });
      const readback = sample.ok
        ? await readClipboardBack(c, `UCLAN${c.runId}${`${s}-bg-${name}`.replace(/[^A-Za-z0-9]/g, "")}N1`)
        : { match: false };
      c.assert(`${s}.background.${name}-applied`, s, sample.ok && readback.match, {
        applied: sample.ok,
        readback: readback.match,
      });
      await c.act.home();
      await c.delay(2000);
    }
    await foreground(c);
  },
  // Two unreachable addresses in front of the working one, app in the foreground (field shape).
  "foreground-bad-first": (c) => warmForeground(c, "bad-first"),
  // The working desktop answers 404 on /healthz (an older host): a protected read must still win.
  "foreground-legacy-host": (c) => warmForeground(c, "legacy-host"),
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
      await c.runFlow("lan-scenarios/enable-background.yaml");
      c.backgroundEnabled = true;
    }
    await foreground(c);
    await waitWarm(c, 0);
    const clock = await clockOffset(c.probe);
    const homeAt = Date.now() + clock.offsetMs;
    await c.act.home();
    await c.delay(5000);
    const service = await c.probe.sample(`${s}-after-home`);
    c.assert(`${s}.service-running`, s, Boolean(service.service.present && service.service.foreground), { service: service.service });
    const putsBefore = await c.peer.mobileLanRequests("PUT", "/SyncClipboard.json");
    const results = await phaseSamples(c, s, undefined, { readback: true });
    judgePhase(c, s, s, results);
    await assertNoEcho(c, s, s, results, putsBefore);
    c.assert(`${s}.clipboard-readback-each`, s, results.every((r) => r.clipboardReadback === true), {
      readback: results.map((r) => r.clipboardReadback ?? null),
    });
    c.probe.event("echo.suppressed", { count: await suppressedSince(c, homeAt) });
    // The subscription opened in the foreground is the one that delivered in the background.
    const churn = (await c.readTraces(homeAt)).filter((t) => t.stage === "sse_attempt").length;
    c.assert(`${s}.subscription-kept-across-home`, s, churn === 0, { newSubscriptions: churn });
    c.assert(`${s}.notified-by-sse`, s, results.every((r) => r.activationToSseMs !== null), {
      withSse: results.filter((r) => r.activationToSseMs !== null).length,
    });
  },

  // Desktop copies land while earlier ones are still being applied in the background and the
  // clipboard poller reads the clipboard every second: nothing applied may be uploaded back. A real
  // copy in another app afterwards must still be uploaded.
  async "echo-interleave"(c) {
    const s = "echo-interleave";
    await ensureServer(c, "bad-first");
    if (!c.backgroundEnabled) {
      await c.runFlow("lan-scenarios/enable-background.yaml");
      c.backgroundEnabled = true;
    }
    await foreground(c);
    await waitWarm(c, 0);
    await c.act.home();
    await c.delay(4000);
    const clock = await clockOffset(c.probe);
    const since = Date.now() + clock.offsetMs;
    const putsBefore = await c.peer.mobileLanRequests("PUT", "/SyncClipboard.json");
    let last;
    for (let i = 1; i <= 10; i++) {
      last = `UCLAN${c.runId}echoN${i}`;
      await c.peer.copyText(last);
      await c.delay(700);
    }
    await c.delay(15_000);
    const traces = await c.readTraces(since);
    const puts = (await c.peer.mobileLanRequests("PUT", "/SyncClipboard.json")) - putsBefore;
    const suppressed = traces.filter((t) => t.stage === "observe_suppressed").length;
    const applied = traces.filter((t) => t.stage === "clipboard_applied").length;
    c.assert(`${s}.no-upload-of-applied`, s, puts === 0, { desktopPuts: puts, suppressed, applied });
    c.probe.event("echo.interleave", { suppressed, applied, puts });
    c.assert(`${s}.ends-on-last`, s, await readbackMatches(c, last));
    await c.act.home();
    await c.delay(2000);
    const userText = `UCLAN${c.runId}echoUser`;
    const beforeUser = await c.peer.mobileLanRequests("PUT", "/SyncClipboard.json");
    await c.act.copyInOtherApp(userText);
    let document;
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      document = await c.observer.currentDocument();
      if (document.text === userText) break;
      await c.delay(500);
    }
    const userPuts = (await c.peer.mobileLanRequests("PUT", "/SyncClipboard.json")) - beforeUser;
    c.assert(`${s}.user-copy-uploaded-in-background`, s, document?.text === userText && userPuts === 1, { userPuts });
  },

  // Three desktop copies in quick succession: the phone ends on the last one and never writes an
  // older one after a newer one.
  async "rapid-copies"(c) {
    const s = "rapid-copies";
    await ensureServer(c, "bad-first");
    await foreground(c);
    await waitWarm(c, 0);
    for (let round = 1; round <= Math.min(3, c.samplesPerPhase); round++) {
      const clock = await clockOffset(c.probe);
      const since = Date.now() + clock.offsetMs - 1000;
      const aliases = [];
      let last;
      for (let i = 1; i <= 3; i++) {
        last = `UCLAN${c.runId}rapidR${round}N${i}`;
        await c.peer.copyText(last);
        const document = await c.observer.currentDocument();
        aliases.push(c.contentAlias(document.contentId));
      }
      await c.delay(6000);
      const applied = (await c.readTraces(since)).filter((t) => t.stage === "clipboard_applied" && aliases.includes(t.cid));
      const order = applied.map((t) => aliases.indexOf(t.cid));
      const monotonic = order.every((value, index) => index === 0 || value > order[index - 1]);
      c.assert(`${s}.r${round}.ends-on-last`, s, order.at(-1) === 2, { appliedOrder: order });
      c.assert(`${s}.r${round}.never-older-after-newer`, s, monotonic, { appliedOrder: order });
      c.assert(`${s}.r${round}.clipboard-readback`, s, await readbackMatches(c, last));
      await foreground(c);
    }
  },

  // A copy made on the phone reaches the desktop exactly once.
  async "upload-once"(c) {
    const s = "upload-once";
    await ensureServer(c, "bad-first");
    await foreground(c);
    await waitWarm(c, 0);
    for (let seq = 1; seq <= Math.min(3, c.samplesPerPhase); seq++) {
      const nonce = `UCLAN${c.runId}upN${seq}`;
      const putsBefore = await c.peer.mobileLanRequests("PUT", "/SyncClipboard.json");
      const clock = await clockOffset(c.probe);
      const since = Date.now() + clock.offsetMs;
      await c.act.copyInOtherApp(nonce);
      await foreground(c);
      let document;
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        document = await c.observer.currentDocument();
        if (document.text === nonce) break;
        await c.delay(500);
      }
      const arrived = document?.text === nonce;
      c.assert(`${s}.n${seq}.desktop-received`, s, arrived);
      await c.delay(4000);
      const phonePuts = (await c.readTraces(since)).filter((t) => t.stage === "put_attempt").length;
      const desktopPuts = (await c.peer.mobileLanRequests("PUT", "/SyncClipboard.json")) - putsBefore;
      // Recorded only: the desktop may announce one inbound document more than once.
      const announcements = arrived ? c.observer.updates.filter((u) => u.contentId === document.contentId).length : 0;
      c.assert(`${s}.n${seq}.uploaded-once`, s, phonePuts === 1 && desktopPuts === 1, { phonePuts, desktopPuts, announcements });
    }
  },

  // Notification Pause: background receiving stops with the service; the user's choice holds
  // until they return. Coming back to the foreground receives as usual.
  async "notification-pause"(c) {
    const s = "notification-pause";
    await ensureServer(c, "bad-first");
    if (!c.backgroundEnabled) {
      await c.runFlow("lan-scenarios/enable-background.yaml");
      c.backgroundEnabled = true;
    }
    await foreground(c);
    await waitWarm(c, 0);
    await c.act.home();
    await c.delay(3000);
    await c.act.tapNotificationAction("Pause");
    await c.delay(3000);
    const sample = await c.probe.sample(`${s}-after-pause`);
    c.assert(`${s}.service-stopped`, s, !sample.service.foreground, { service: sample.service });
    const paused = await measureCopy(c, `${s}-background`, 1, { timeoutMs: 20_000, expectApplied: false });
    c.assert(`${s}.not-received-while-paused`, s, !paused.ok);
    const clock = await clockOffset(c.probe);
    const quiet = (await c.readTraces(Date.now() + clock.offsetMs - 15_000)).filter((t) =>
      ["get_attempt", "sse_attempt", "health_result"].includes(t.stage)
    ).length;
    c.assert(`${s}.no-network-while-paused`, s, quiet === 0, { requests: quiet });
    await foreground(c);
    const resumed = await measureCopy(c, `${s}-foreground`, 1);
    c.assert(`${s}.foreground-receives`, s, resumed.ok);
  },

  // The desktop revokes this phone: nothing is applied and the phone does not retry in a loop.
  async "auth-revoked"(c) {
    const s = "auth-revoked";
    await ensureServer(c, "bad-first");
    await foreground(c);
    await waitWarm(c, 0);
    await c.peer.revokeMobile(c.phone.deviceId);
    const clock = await clockOffset(c.probe);
    const since = Date.now() + clock.offsetMs;
    const sample = await measureCopy(c, s, 1, { timeoutMs: 20_000, expectApplied: false });
    c.assert(`${s}.not-applied`, s, !sample.ok);
    const traces = await c.readTraces(since);
    const reads = traces.filter((t) => t.stage === "get_attempt").length;
    // Foreground fallback polling is every 2 s; a retry loop would be far above one read per poll.
    c.assert(`${s}.bounded-retries`, s, reads <= 15, { readsIn20s: reads });
    c.assert(`${s}.auth-observed`, s, traces.some((t) => t.status === "401"), {});
  },

  // After a desktop copy is applied, the user's own later copies still reach the desktop, including
  // copying that same content again once the clipboard held something else.
  async "user-copy-after-receive"(c) {
    const s = "user-copy-after-receive";
    await ensureServer(c, "bad-first");
    await foreground(c);
    await waitWarm(c, 0);
    const received = await measureCopy(c, s, 1);
    c.assert(`${s}.received`, s, received.ok);
    const appliedNonce = `UCLAN${c.runId}${s.replace(/[^A-Za-z0-9]/g, "")}N1`;
    for (const [step, text] of [["other", `UCLAN${c.runId}userC`], ["same-again", appliedNonce]]) {
      const before = await c.peer.mobileLanRequests("PUT", "/SyncClipboard.json");
      await c.act.copyInOtherApp(text);
      await foreground(c);
      let document;
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        document = await c.observer.currentDocument();
        if (document.text === text && (await c.peer.mobileLanRequests("PUT", "/SyncClipboard.json")) > before) break;
        await c.delay(500);
      }
      const puts = (await c.peer.mobileLanRequests("PUT", "/SyncClipboard.json")) - before;
      c.assert(`${s}.${step}.sent-once`, s, document?.text === text && puts === 1, { puts });
      await c.delay(2000);
    }
  },

  // The desktop commits an upload but its reply is lost: the phone must not send it again.
  async "put-response-lost"(c) {
    const s = "put-response-lost";
    await ensureServer(c, "put-lost");
    await foreground(c);
    c.assert(`${s}.session-warm`, s, await waitWarm(c, 0));
    const text = `UCLAN${c.runId}putlost`;
    const before = await c.peer.mobileLanRequests("PUT", "/SyncClipboard.json");
    const clock = await clockOffset(c.probe);
    const since = Date.now() + clock.offsetMs;
    await c.act.copyInOtherApp(text);
    await foreground(c);
    await c.delay(25_000);
    const puts = (await c.peer.mobileLanRequests("PUT", "/SyncClipboard.json")) - before;
    const document = await c.observer.currentDocument();
    const traces = (await c.readTraces(since)).filter((t) => t.stage === "put_attempt" || t.stage === "put_result");
    c.assert(`${s}.desktop-committed`, s, document.text === text);
    c.assert(`${s}.not-resent`, s, puts === 1 && traces.filter((t) => t.stage === "put_attempt").length === 1, {
      desktopPuts: puts,
      phone: traces.map((t) => ({ stage: t.stage, status: t.status })),
    });
    c.assert(`${s}.reported-unknown`, s, traces.some((t) => t.stage === "put_result" && t.status === "unknown"));
  },

  // The phone's storage is full when a desktop copy arrives: the clipboard is written, the history
  // record fails; once space returns the record is saved without writing the clipboard again.
  async "history-save-failure"(c) {
    const s = "history-save-failure";
    await ensureServer(c, "bad-first");
    await foreground(c);
    await waitWarm(c, 0);
    const fill = "/data/local/tmp/uclan-fill";
    // Fills only this owned emulator's data partition; removed below in every case.
    // Large blocks first, then single blocks, so not even a few database pages remain free.
    await c.probe.shell(`dd if=/dev/zero of=${fill} bs=4194304 2>/dev/null; dd if=/dev/zero of=${fill}-tail bs=4096 2>/dev/null; sync`).catch(() => "");
    const free = await c.probe.shell("df /data | tail -1").catch(() => "");
    c.probe.event("storage.filled", { df: free.replace(/\s+/g, " ").slice(0, 120) });
    let sample;
    try {
      sample = await measureCopy(c, s, 1, { timeoutMs: 30_000 });
    } finally {
      await c.probe.shell(`rm -f ${fill} ${fill}-tail; sync`).catch(() => "");
    }
    c.assert(`${s}.clipboard-applied-while-full`, s, sample.ok);
    const clock = await clockOffset(c.probe);
    const since = Date.now() + clock.offsetMs - 120_000;
    let traces = [];
    const deadline = Date.now() + 75_000;
    while (Date.now() < deadline) {
      traces = (await c.readTraces(since)).filter((t) => t.cid === sample.alias);
      if (traces.some((t) => t.stage === "history_saved")) break;
      await c.delay(2000);
    }
    const stages = traces.map((t) => t.stage);
    c.assert(`${s}.history-failed-first`, s, stages.includes("history_failed"), { stages });
    c.assert(`${s}.history-saved-later`, s, stages.includes("history_saved"), { stages });
    c.assert(`${s}.clipboard-written-once`, s, stages.filter((t) => t === "clipboard_applied").length === 1, { stages });
    if (sample.ok) {
      const nonce = `UCLAN${c.runId}${s.replace(/[^A-Za-z0-9]/g, "")}N1`;
      try {
        await c.runFlow("lan-scenarios/history-contains.yaml", { INCOMING: nonce });
        c.assert(`${s}.visible-in-history`, s, true);
      } catch {
        c.assert(`${s}.visible-in-history`, s, false);
      }
    }
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
