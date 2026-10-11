// Splits one desktop-to-phone copy into ordered stages. Every parent is the sum of its children
// only where the children are sequential; parallel references are marked `reference` and never
// added. A missing boundary leaves the stage null (unknown) instead of borrowing a neighbour.
import { distribution } from "./timeline.mjs";

const after = (list, predicate, atOrAfter) => list.find((t) => t.wall >= atOrAfter && predicate(t));

/** Native overlay timing for one operation ("read" ops carry their tag, writes use setStringViaOverlay). */
function overlayOperation(native, from, to, write) {
  const inWindow = native.filter((n) => n.wall >= from && n.wall <= to);
  const ops = write ? ["setStringViaOverlay", "write"] : ["getStringViaOverlay", "read"];
  const mine = inWindow.filter((n) => ops.includes(n.op));
  const stage = (name) => mine.find((n) => n.stage === name);
  const request = stage("request");
  const main = stage("main");
  const focus = stage("focus");
  const done = stage(write ? "clip_written" : "clip_read");
  const released = stage("released");
  return {
    used: Boolean(request),
    request,
    main,
    focus,
    done,
    released,
    focusHow: focus?.how ?? null,
    attempts: done?.attempts ? Number(done.attempts) : null,
  };
}

const span = (a, b) => (a !== undefined && a !== null && b !== undefined && b !== null ? Math.round(b - a) : null);

/**
 * `traces`: phone lan.trace records (phone wall); `native`: UcClipTiming records (phone wall);
 * `desktop`: listener log points on the host clock; `activation` and `observerReceived` on the host
 * clock; `offset`: phone minus host.
 */
export function buildSegments({ traces, native, desktop, alias, activation, observerReceived, offset }) {
  const host = (wall) => (wall === undefined || wall === null ? null : wall - offset);
  const T = (stage, predicate = () => true, from = 0) => after(traces, (t) => t.stage === stage && predicate(t), from);
  const sse = T("sse_event", (t) => t.type === "update" && t.cid === alias);
  const start = sse?.wall ?? 0;
  const request = sse ? T("sync_request", () => true, sse.wall) : null;
  const syncStart = request ? T("sync_start", () => true, request.wall) : null;
  const getResult = T("get_result", (t) => t.cid === alias && t.valid === "true", start);
  const getAttempt = getResult
    ? [...traces].reverse().find((t) => t.stage === "get_attempt" && t.wall <= getResult.wall && t.wall >= start)
    : null;
  const remoteNew = T("remote_new", (t) => t.cid === alias, start);
  const readDone = T("clipboard_read_done", (t) => t.cid === alias, start);
  const applyStart = T("apply_start", (t) => t.cid === alias, start);
  const writeDone = T("clipboard_write_done", (t) => t.cid === alias, start);
  const applied = T("clipboard_applied", (t) => t.cid === alias, start);
  const history = T("history_saved", (t) => t.cid === alias, start);
  const ui = T("ui_committed", (t) => t.cid === alias, start);

  // The listener's own log for this GET (host clock), between the phone's request and response.
  let server = null;
  if (getAttempt && getResult) {
    const from = host(getAttempt.wall) - 50;
    const to = host(getResult.wall) + 50;
    const incoming = desktop.find((d) => d.kind === "incoming" && d.method === "GET" && d.at >= from && d.at <= to);
    if (incoming) {
      const auth = desktop.find((d) => d.kind === "auth" && d.method === "GET" && d.at >= incoming.at && d.at <= to);
      const done = desktop.find((d) => d.kind === "get_done" && d.at >= (auth?.at ?? incoming.at) && d.at <= to);
      server = { incoming: incoming.at, auth: auth?.at ?? null, done: done?.at ?? null };
    }
  }

  const read = readDone && remoteNew ? overlayOperation(native, remoteNew.wall, readDone.wall, false) : null;
  const write = writeDone && applyStart ? overlayOperation(native, applyStart.wall, writeDone.wall, true) : null;
  const nativeChildren = (op, from, to) =>
    op?.used
      ? {
          js_to_native: span(from, op.request.wall),
          main_thread_wait: span(op.request.wall, op.main?.wall),
          focus_wait: span(op.main?.wall, op.focus?.wall),
          clipboard_call: span(op.focus?.wall, op.done?.wall),
          release_and_return_to_js: span(op.done?.wall, to),
          focus: op.focusHow,
          attempts: op.attempts,
        }
      : { overlay: "not used (system clipboard API)" };

  const segments = {
    total_activation_to_clipboard: span(activation, host(applied?.wall)),
    "1_desktop_to_phone_notification": span(activation, host(sse?.wall)),
    "1r_desktop_publish_seen_on_host_loopback": { reference: true, ms: span(activation, observerReceived) },
    "2_notification_to_pull_start": span(sse?.wall, syncStart?.wall),
    "2a_js_dispatch": span(sse?.wall, request?.wall),
    "2b_single_flight_wait": span(request?.wall, syncStart?.wall),
    "3_route_selection": span(syncStart?.wall, getAttempt?.wall),
    "4_get": span(getAttempt?.wall, getResult?.wall),
    "4a_client_to_server": server ? span(host(getAttempt.wall), server.incoming) : null,
    "4b_server_basic_auth": server ? span(server.incoming, server.auth) : null,
    "4c_server_snapshot_read": server ? span(server.auth, server.done) : null,
    "4d_response_to_js": server ? span(server.done, host(getResult.wall)) : null,
    "5_dedupe": span(getResult?.wall, remoteNew?.wall),
    "6_clipboard_read": span(remoteNew?.wall, readDone?.wall),
    "6x_clipboard_read_native": nativeChildren(read, remoteNew?.wall, readDone?.wall),
    "7_apply_prepare": span(readDone?.wall, applyStart?.wall),
    "8_clipboard_write": span(applyStart?.wall, writeDone?.wall),
    "8x_clipboard_write_native": nativeChildren(write, applyStart?.wall, writeDone?.wall),
    "9_watermark_and_activation_record": span(writeDone?.wall, applied?.wall),
    after_history_save: span(applied?.wall, history?.wall),
    after_ui_store_commit: span(history?.wall, ui?.wall),
    ui_render: "unknown (no render signal)",
  };
  return segments;
}

/** n/p50/p95/max per numeric stage across samples (references and native children flattened). */
export function summarizeSegments(samples) {
  const values = {};
  for (const sample of samples) {
    for (const [key, value] of Object.entries(sample.segments ?? {})) {
      if (typeof value === "number") (values[key] ??= []).push(value);
      else if (value && typeof value === "object") {
        for (const [child, v] of Object.entries(value)) {
          if (typeof v === "number" && child !== "attempts") (values[`${key}.${child}`] ??= []).push(v);
        }
      }
    }
  }
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, distribution(v)]));
}
