// Each scenario states the intended behaviour as assertions. Run against an older APK, the failing
// assertions are the recorded control; run against a fixed APK they are the acceptance evidence.
// `c` is the shared context built by run.mjs. Fixtures are synthetic and unique per run.

const TEMP_STOPPED_TEXT = /temporarily stopped/i;
const SAMPLE_SECONDS = [0, 2, 5, 10, 30];
const MOBILE_TO_DESKTOP_MS = 20_000;
// The Engine (rc.22) treats up to two text changes within 5 s after it wrote a remote entry to the
// clipboard as echoes of that write and does not sync them. A person copies later than that; the
// harness waits it out so the fixture is a genuine new copy, and the report names the behaviour.
const ENGINE_ECHO_SETTLE_MS = 8_000;

async function ensureSetup(c) {
  if (c.setupDone) return;
  const code = await c.peer.prepare();
  await c.runFlow("network-scenarios/join.yaml", {
    INVITATION_CODE: code,
    SPACE_PASSWORD: c.peer.passphrase,
  });
  await c.runFlow("network-scenarios/diagnostic-background-enable.yaml");
  await c.peer.waitOnline("setup");
  c.setupDone = true;
}

/** A fresh process with the background switch still enabled; pairing and settings persist. */
async function freshProcess(c, tag) {
  await c.probe.shell(`am force-stop ${c.appId}`);
  if (c.backgroundDisabledByStop) {
    // The notification's Stop switches the background setting off for good, as intended; a later
    // scenario that needs the service has to turn it on again the way a user would.
    await c.probe.shell(`am start -n ${c.appId}/app.uniclipboard.android.MainActivity`);
    await c.runFlow("network-scenarios/diagnostic-background-enable.yaml");
    await c.probe.shell(`am force-stop ${c.appId}`);
    c.backgroundDisabledByStop = false;
  }
  await c.probe.shell(`am start -n ${c.appId}/app.uniclipboard.android.MainActivity`);
  await c.runFlow("lifecycle/launch.yaml");
  await c.peer.waitOnline(`${tag}-fresh`);
}

/** Foreground exchange: proves the pair works before any background claim is made. */
async function baseline(c, tag) {
  const incoming = `UCBG${c.runId}${tag}In`;
  const outgoing = `UCBG${c.runId}${tag}Out`;
  // The peer can list the phone online a moment before a send reaches it ("1 offline"); retry briefly.
  for (let attempt = 1; ; attempt++) {
    try {
      await c.peer.send(incoming, `${tag}-baseline`);
      break;
    } catch (error) {
      if (attempt >= 4 || !/offline/.test(String(error.stdout ?? error.message))) throw error;
      await c.delay(8000);
    }
  }
  await c.runFlow("network-scenarios/exchange.yaml", { INCOMING: incoming, OUTGOING: outgoing });
  await c.peer.expectReceived(outgoing, `${tag}-baseline`);
  c.assert(`${tag}.baseline-exchange`, tag, true);
}

async function sampleAfterHome(c, scenario) {
  const t0 = Date.now();
  const samples = [];
  for (const seconds of SAMPLE_SECONDS) {
    const wait = t0 + seconds * 1000 - Date.now();
    if (wait > 0) await c.delay(wait);
    samples.push({ seconds, ...(await c.probe.sample(`${scenario}+${seconds}s`)) });
  }
  return samples;
}

/** Latency is measured from `startedAt`, the moment the copy began (the helper app holds the clipboard ~2.5 s). */
async function timedReceive(c, text, phase, startedAt = Date.now()) {
  try {
    await c.peer.expectReceived(text, phase);
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch {
    return { ok: false, latencyMs: Date.now() - startedAt, peerLatest: (await c.peer.latestText()).trim().slice(0, 160) };
  }
}

async function backgroundStateTexts(c) {
  await c.runFlow("background-scenarios/open-background-settings.yaml");
  return c.probe.uiTexts();
}

/** Journal files from several processes are not ordered by file, so windows use the event time. */
async function journalSince(c, sinceEpochMs) {
  const all = await c.probe.journal();
  return all.filter((e) => Date.parse(e.timestamp) >= sinceEpochMs);
}

/** Engine-owner transitions from logcat (counts only), since a time. */
async function ownerLog(c, sinceEpochMs) {
  const raw = await c.probe.run("logcat", "-d", "-v", "epoch", "-t", "20000", "UcEngine:I", "*:S").catch(() => "");
  return raw
    .split("\n")
    .filter((l) => /engine_owner/.test(l) && Number(l.match(/^\s*(\d+\.\d+)/)?.[1]) * 1000 >= sinceEpochMs)
    .map((l) => l.replace(/^.*engine_owner/, "engine_owner"));
}

const stopEvents = (events) =>
  events.filter((e) =>
    /background_service\.(stopped|task_removed|timed_out|destroyed)/.test(JSON.stringify(e))
  );

export const SCENARIOS = {
  // Home only. No task is removed, no permission changes, no reopening before the data checks.
  // Each round leaves the app with Home, waits, then moves one fixture each way.
  async home(c) {
    const s = "home";
    await ensureSetup(c);
    await baseline(c, s);
    const before = Date.now() - 2000;
    for (let round = 1; round <= c.rounds; round++) {
      const tag = `${s}.r${round}`;
      if (round > 1) await c.runFlow("lifecycle/launch.yaml");
      await c.act.home();
      const samples = await sampleAfterHome(c, tag);
      const last = samples.at(-1);
      c.assert(`${tag}.service-present-after-30s`, s, Boolean(last.service.present && last.service.foreground), { service: last.service });

      const incoming = `UCBG${c.runId}H${round}B`;
      const outgoing = `UCBG${c.runId}H${round}A`;
      let delivered = true;
      let detail = {};
      try {
        await c.peer.send(incoming, `${tag}-background`);
      } catch (error) {
        delivered = false;
        detail = { error: String(error.stdout ?? error.message).trim().slice(0, 160) };
      }
      c.assert(`${tag}.desktop-to-mobile-accepted-in-background`, s, delivered, detail);
      await c.delay(ENGINE_ECHO_SETTLE_MS);

      const copiedAt = Date.now();
      await c.act.copyInOtherApp(outgoing);
      const received = await timedReceive(c, outgoing, `${tag}-background`, copiedAt);
      received.engineOperations = await c.probe.engineOperations(copiedAt);
      if (!received.ok) received.jsClipboardLogs = await c.probe.clipboardLogs(copiedAt);
      c.assert(`${tag}.mobile-to-desktop-in-background`, s, received.ok && received.latencyMs <= MOBILE_TO_DESKTOP_MS, received);
    }

    await c.runFlow("background-scenarios/history-contains.yaml", { INCOMING: `UCBG${c.runId}H${c.rounds}B` });
    c.assert("home.last-desktop-fixture-saved", s, true);
    const texts = await backgroundStateTexts(c);
    c.assert("home.not-temporarily-stopped", s, !texts.some((t) => TEMP_STOPPED_TEXT.test(t)), { texts: texts.slice(0, 20) });
    const events = await journalSince(c, before);
    c.assert("home.no-service-stop-recorded", s, stopEvents(events).length === 0, { stops: stopEvents(events) });
  },

  // Auxiliary tasks (quick action, restart prompt) end on their own; that must not pause the sync.
  async "aux-task"(c) {
    const s = "aux-task";
    await ensureSetup(c);
    await freshProcess(c, s);
    const before = Date.now() - 2000;
    await c.act.home();
    for (const component of [
      "app.uniclipboard.android.quickaction.QuickActionActivity",
      "app.uniclipboard.android.servicerestart.ServiceRestartActivity",
    ]) {
      const result = await c.act.startActivity(component).catch((error) => `error:${error.message.slice(0, 120)}`);
      c.probe.event("aux.start", { component: component.split(".").at(-1), result: String(result).slice(0, 160) });
      await c.delay(5000);
      // A quick action waits for the user; closing it is what ends its task. A restart prompt ends itself.
      const shown = await c.probe.sample(`shown-${component.split(".").at(-1)}`);
      if (shown.topResumed?.includes(component.split(".").at(-1))) await c.probe.shell("input keyevent KEYCODE_BACK");
      await c.delay(3000);
      await c.probe.sample(`after-${component.split(".").at(-1)}`);
      await c.act.home();
    }
    const events = await journalSince(c, before);
    c.assert("aux-task.no-service-stop-recorded", s, stopEvents(events).length === 0, { stops: stopEvents(events) });
    const auxSeen = events.filter((e) => /task_removed/.test(e.event ?? ""));
    // Whether the system reported the auxiliary tasks' end varies by timing; recorded, not asserted.
    c.probe.event("aux.removals", { observed: auxSeen.map((e) => e.event) });
    const texts = await backgroundStateTexts(c);
    c.assert("aux-task.not-temporarily-stopped", s, !texts.some((t) => TEMP_STOPPED_TEXT.test(t)), { texts: texts.slice(0, 20) });
    await c.act.home();
    const outgoing = `UCBG${c.runId}AuxA`;
    const copiedAt = Date.now();
    await c.act.copyInOtherApp(outgoing);
    const received = await timedReceive(c, outgoing, "aux-background", copiedAt);
    c.assert("aux-task.mobile-to-desktop-after-aux-tasks", s, received.ok && received.latencyMs <= MOBILE_TO_DESKTOP_MS, received);
  },

  // Positive control: the notification "Pause" action must be visible as a policy pause, not a fault.
  async "notification-pause"(c) {
    const s = "notification-pause";
    await ensureSetup(c);
    await freshProcess(c, s);
    const before = Date.now() - 2000;
    await c.act.home();
    await c.act.tapNotificationAction("Pause");
    await c.delay(3000);
    const sample = await c.probe.sample("after-pause");
    c.assert("notification-pause.service-stopped", s, !sample.service.foreground, { sample });
    const events = await journalSince(c, before);
    c.assert("notification-pause.stop-recorded", s, stopEvents(events).length > 0, { events: stopEvents(events) });
    c.assert(
      "notification-pause.cause-is-distinguishable",
      s,
      stopEvents(events).some((e) => /pause|user_pause|temp/i.test(JSON.stringify(e))),
      { events: stopEvents(events) }
    );
    const texts = await backgroundStateTexts(c);
    c.assert("notification-pause.ui-shows-temporarily-stopped", s, texts.some((t) => TEMP_STOPPED_TEXT.test(t)), { texts: texts.slice(0, 20) });
  },

  // Positive control for the task that holds the main activity: dismissing the app from recents
  // keeps its existing meaning, a pause that is recorded as such and shown in settings.
  async "main-task-removed"(c) {
    const s = "main-task-removed";
    await ensureSetup(c);
    await freshProcess(c, s);
    const before = Date.now() - 2000;
    await c.act.home();
    await c.act.swipeAppAwayFromRecents();
    await c.delay(4000);
    const sample = await c.probe.sample("after-swipe");
    c.assert("main-task-removed.service-stopped", s, !sample.service.foreground, { service: sample.service });
    const events = await journalSince(c, before);
    c.assert("main-task-removed.recorded-as-task-removed", s, events.some((e) => e.event === "background_service.task_removed"), {
      events: events.filter((e) => /background_service/.test(e.event ?? "")).map((e) => `${e.event}/${e.trigger}`),
    });
  },

  // The process dies without a callback. The system restarts the sticky service without any JS, so
  // the app can only offer a restart prompt; the prompt's outcome must reflect what really started.
  async "process-death"(c) {
    const s = "process-death";
    await ensureSetup(c);
    await freshProcess(c, s);
    const before = Date.now() - 2000;
    await c.act.home();
    const first = await c.probe.sample("before-kill");
    await c.act.killProcess();
    await c.delay(12_000);
    const dead = await c.probe.sample("after-kill");
    c.assert("process-death.process-replaced-or-gone", s, dead.pid !== first.pid, { before: first.pid, after: dead.pid });
    const events = await journalSince(c, before);
    c.assert("process-death.system-restart-recorded-without-js", s, events.some((e) => e.event === "background_service.system_restart"), {
      events: events.filter((e) => /background_service/.test(e.event ?? "")).map((e) => `${e.event}/${e.trigger}`),
    });
    await c.act.tapNotificationText("Tap to resume background service");
    await c.delay(8000);
    const resumed = await c.probe.sample("after-restart-prompt");
    c.assert("process-death.prompt-restores-running-service", s, Boolean(resumed.service.present && resumed.service.foreground), { service: resumed.service });
    await c.act.home();
    await c.peer.waitOnline("process-death-after-prompt");
    const outgoing = `UCBG${c.runId}DeathA`;
    const copiedAt = Date.now();
    await c.act.copyInOtherApp(outgoing);
    const received = await timedReceive(c, outgoing, "process-death-background", copiedAt);
    c.assert("process-death.mobile-to-desktop-after-restore", s, received.ok && received.latencyMs <= MOBILE_TO_DESKTOP_MS, received);
  },

  // API 35+ ends a dataSync foreground service whose background budget is used up. Per the Android 15
  // behaviour-change page, the test hook is the compat change FGS_INTRODUCE_TIME_LIMITS plus a shortened
  // data_sync_fgs_timeout_duration (both on this owned emulator only, removed afterwards). A service of
  // type connectedDevice has no such budget, so for it the same window must leave the service running.
  async "fgs-timeout"(c) {
    const s = "fgs-timeout";
    await ensureSetup(c);
    const key = "data_sync_fgs_timeout_duration";
    await c.probe.shell(`am compat enable FGS_INTRODUCE_TIME_LIMITS ${c.appId}`);
    await c.probe.shell(`device_config set_sync_disabled_for_tests persistent`).catch(() => "");
    await c.probe.shell(`device_config put activity_manager ${key} 45000`);
    const applied = (await c.probe.shell("dumpsys activity settings").catch(() => "")).match(new RegExp(`${key}=(\\d+)`))?.[1];
    c.assert("fgs-timeout.hook-applied", s, applied === "45000", { dataSyncTimeoutMs: applied ?? null });
    try {
      await freshProcess(c, s);
      const before = Date.now() - 2000;
      await c.act.home();
      await c.delay(4000);
      const services = await c.probe.shell(`dumpsys activity services ${c.appId}`).catch(() => "");
      const types = parseInt(services.match(/foregroundServiceType=0x([0-9a-f]+)/)?.[1] ?? services.match(/types?=0x([0-9a-f]+)/)?.[1] ?? "0", 16);
      const dataSync = (types & 0x1) !== 0;
      const first = await c.probe.sample("before-timeout");
      await c.delay(110_000);
      const after = await c.probe.sample("after-timeout-window");
      const events = await journalSince(c, before);
      const timedOut = events.some((e) => e.event === "background_service.timed_out");
      if (dataSync) {
        c.assert("fgs-timeout.service-ended", s, !after.service.foreground, { service: after.service });
        c.assert("fgs-timeout.process-survived-the-timeout", s, Boolean(after.pid) && after.pid === first.pid, { before: first.pid, after: after.pid });
        c.assert("fgs-timeout.timeout-recorded-and-handled", s, timedOut, {
          events: events.filter((e) => /background_service/.test(e.event ?? "")).map((e) => `${e.event}/${e.trigger}`),
        });
        const reason = await c.probe.shell(`run-as ${c.appId} cat shared_prefs/uc_background_service.xml`).catch(() => "");
        c.assert("fgs-timeout.reason-queryable", s, /system_timeout/.test(reason), { prefs: reason.replace(/\s+/g, " ").slice(0, 200) });
      } else {
        c.assert("fgs-timeout.no-budget-for-this-type", s, Boolean(after.service.foreground) && !timedOut, { types, service: after.service });
      }
    } finally {
      await c.probe.shell(`device_config delete activity_manager ${key}`).catch(() => "");
      await c.probe.shell(`am compat reset FGS_INTRODUCE_TIME_LIMITS ${c.appId}`).catch(() => "");
    }
  },

  // The service declares an honest type and holds the multicast lock mDNS discovery needs, only while it runs.
  async "fgs-type"(c) {
    const s = "fgs-type";
    await ensureSetup(c);
    await freshProcess(c, s);
    await c.act.home();
    await c.delay(3000);
    const services = await c.probe.shell(`dumpsys activity services ${c.appId}`).catch(() => "");
    const types = services.match(/foregroundServiceType=0x([0-9a-f]+)/)?.[1] ?? services.match(/types?=0x([0-9a-f]+)/)?.[1] ?? null;
    // 0x10 is FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE; 0x1 is dataSync.
    c.assert("fgs-type.connected-device", s, types !== null && (parseInt(types, 16) & 0x10) !== 0, { types, excerpt: services.split("\n").filter((l) => /foregroundService|types/i.test(l)).slice(0, 4) });
    const wifi = await c.probe.shell("dumpsys wifi").catch(() => "");
    const held = wifi.split("\n").filter((l) => /Multicaster\{uniclipboard-mdns/.test(l));
    c.assert("fgs-type.multicast-lock-held-while-running", s, held.length > 0, { held: held.slice(0, 2) });
    await c.act.tapNotificationAction("Stop");
    c.backgroundDisabledByStop = true;
    await c.delay(3000);
    const afterStop = (await c.probe.shell("dumpsys wifi").catch(() => "")).split("\n").filter((l) => /Multicaster\{uniclipboard-mdns/.test(l));
    c.assert("fgs-type.multicast-lock-released-after-stop", s, afterStop.length === 0, { held: afterStop.slice(0, 2) });
  },

  // A reboot ends the service without a user action: recovery must be a visible, observable prompt.
  async "boot-recovery"(c) {
    const s = "boot-recovery";
    await ensureSetup(c);
    await freshProcess(c, s);
    await c.act.home();
    const before = Date.now() - 2000;
    const prefs = await c.probe.shell(`run-as ${c.appId} cat shared_prefs/uc_background_intent.xml`).catch(() => "");
    c.assert("boot-recovery.enabled-intent-recorded", s, /name="enabled" value="true"/.test(prefs), { prefs: prefs.replace(/\s+/g, " ").slice(0, 160) });
    await c.probe.run("reboot");
    await c.delay(20_000);
    await c.probe.run("wait-for-device");
    for (let i = 0; i < 60; i++) {
      if ((await c.probe.shell("getprop sys.boot_completed").catch(() => "")).trim() === "1") break;
      await c.delay(5000);
    }
    await c.probe.run("root").catch(() => "");
    await c.delay(2000);
    await c.probe.shell("input keyevent KEYCODE_WAKEUP").catch(() => "");
    await c.probe.shell("wm dismiss-keyguard").catch(() => "");
    await c.delay(45_000);
    const events = await journalSince(c, before);
    const recovery = events.filter((e) => /background_service\.recovery_/.test(e.event ?? "")).map((e) => `${e.event}/${e.trigger}`);
    c.assert("boot-recovery.decision-recorded", s, recovery.some((e) => e.includes("systemBoot")), { recovery });
    const notifications = await c.probe.shell("dumpsys notification --noredact").catch(() => "");
    c.assert("boot-recovery.prompt-visible", s, /Tap to resume background service/.test(notifications) || /foreground_service_restart/i.test(notifications), { matched: (notifications.match(/.*resume.*/gi) ?? []).slice(0, 3) });
    c.assert("boot-recovery.no-silent-claim-of-running", s, !(await c.probe.sample("after-boot")).service.foreground, {});
    await c.act.tapNotificationText("Tap to resume background service");
    await c.delay(10_000);
    const resumed = await c.probe.sample("after-boot-prompt");
    c.assert("boot-recovery.prompt-restores-running-service", s, Boolean(resumed.service.present && resumed.service.foreground), { service: resumed.service });
  },

  // An app update ends the service the same way; the user's own stop must still be respected.
  async "package-replaced"(c) {
    const s = "package-replaced";
    await ensureSetup(c);
    await freshProcess(c, s);
    await c.act.home();
    const apk = c.appApk;
    const before = Date.now() - 2000;
    await c.probe.run("install", "-r", apk);
    await c.delay(15_000);
    let events = await journalSince(c, before);
    c.assert("package-replaced.prompted-when-enabled", s, events.some((e) => e.event === "background_service.recovery_prompted" && e.trigger === "packageReplaced"), {
      events: events.filter((e) => /recovery/.test(e.event ?? "")).map((e) => `${e.event}/${e.trigger}`),
    });
    // Respect the user's stop: after Stop in the notification, an update must not prompt.
    await freshProcess(c, `${s}-stop`);
    await c.act.home();
    await c.act.tapNotificationAction("Stop");
    c.backgroundDisabledByStop = true;
    await c.delay(3000);
    const mark = Date.now() - 500;
    await c.probe.run("install", "-r", apk);
    await c.delay(15_000);
    events = await journalSince(c, mark);
    c.assert("package-replaced.respects-user-stop", s, events.some((e) => e.event === "background_service.recovery_skipped") && !events.some((e) => e.event === "background_service.recovery_prompted"), {
      events: events.filter((e) => /recovery/.test(e.event ?? "")).map((e) => `${e.event}/${e.trigger}`),
    });
  },

  // The native connectivity callback reaches the Engine without waiting for JS.
  async "network-hint"(c) {
    const s = "network-hint";
    await ensureSetup(c);
    await freshProcess(c, s);
    await c.act.home();
    await c.delay(3000);
    const since = Date.now();
    await c.probe.shell("svc wifi disable");
    await c.delay(6000);
    await c.probe.shell("svc wifi enable");
    await c.delay(20_000);
    const raw = await c.probe.run("logcat", "-d", "-v", "epoch", "-t", "20000", "UcEngine:I", "*:S").catch(() => "");
    const hints = raw.split("\n").filter((l) => /native_network_hint/.test(l) && Number(l.match(/^\s*(\d+\.\d+)/)?.[1]) * 1000 >= since);
    c.assert("network-hint.native-hint-delivered", s, hints.some((l) => /outcome=delivered/.test(l)), { hints: hints.slice(0, 4).map((l) => l.replace(/^.*native_network_hint/, "native_network_hint")) });
    await c.peer.waitOnline("network-hint-recovered");
    c.assert("network-hint.peer-online-after-recovery", s, true);
  },

  // Diagnostic only: records what the notification shade and the notification manager show.
  async "debug-notifications"(c) {
    const s = "debug-notifications";
    await ensureSetup(c);
    await freshProcess(c, s);
    await c.act.home();
    await c.delay(4000);
    const dump = await c.probe.shell("dumpsys notification --noredact").catch(() => "");
    const mine = dump.split("\n").filter((l) => /pkg=app\.uniclipboard|actions|title=|android\.text|flags=/i.test(l)).slice(0, 60);
    await c.probe.shell("cmd statusbar expand-notifications");
    await c.delay(2000);
    const shade = await c.probe.uiTexts().catch(() => []);
    await c.probe.shell("input swipe 540 1500 540 400 300").catch(() => "");
    await c.delay(1000);
    const shade2 = await c.probe.uiTexts().catch(() => []);
    c.assert("debug-notifications.recorded", s, true, { mine, shade, shade2 });
  },

  // Exploration aid: sets the pair up, then keeps the emulator alive so a person can inspect the UI.
  async hold(c) {
    await ensureSetup(c);
    await freshProcess(c, "hold");
    await c.act.home();
    c.assert("hold.ready", "hold", true, { serial: c.device.id });
    await c.delay(Number(process.env.HOLD_SECONDS ?? 3000) * 1000);
  },

  // Failure mode: the Activity is destroyed every time the user leaves it while the service is
  // enabled. The Engine must keep syncing both ways because the service, not the Activity, owns it.
  async "activity-destroy"(c) {
    const s = "activity-destroy";
    await ensureSetup(c);
    await freshProcess(c, s);
    await baseline(c, s);
    await c.probe.shell("settings put global always_finish_activities 1");
    try {
      const since = Date.now();
      await c.act.home();
      await c.delay(6000);
      const sample = await c.probe.sample("activity-destroyed");
      c.assert("activity-destroy.service-still-foreground", s, Boolean(sample.service.foreground), { service: sample.service });
      const incoming = `UCBG${c.runId}ADB`;
      await c.peer.send(incoming, `${s}-background`);
      await c.delay(ENGINE_ECHO_SETTLE_MS);
      const copiedAt = Date.now();
      await c.act.copyInOtherApp(`UCBG${c.runId}ADA`);
      const received = await timedReceive(c, `UCBG${c.runId}ADA`, `${s}-background`, copiedAt);
      c.assert("activity-destroy.mobile-to-desktop", s, received.ok && received.latencyMs <= MOBILE_TO_DESKTOP_MS, received);
      const owner = await ownerLog(c, since);
      c.assert("activity-destroy.engine-never-shut-down", s, !owner.some((l) => /shutdown=true/.test(l)), { owner });
    } finally {
      await c.probe.shell("settings put global always_finish_activities 0").catch(() => "");
    }
  },

  // Failure mode: repeated or overlapping START commands (a stop still in flight, a duplicate from the
  // JS side) must leave one foreground service, one Engine hold and one multicast lock.
  async "start-idempotent"(c) {
    const s = "start-idempotent";
    await ensureSetup(c);
    await freshProcess(c, s);
    await c.act.home();
    await c.delay(4000);
    const since = Date.now();
    const component = `${c.appId}/expo.modules.foregroundservice.SyncForegroundService`;
    for (let i = 0; i < 5; i++) {
      await c.probe.shell(`am start-foreground-service -n ${component} -a START`).catch(() => "");
      await c.delay(300);
    }
    await c.delay(4000);
    const sample = await c.probe.sample("after-duplicate-starts");
    c.assert("start-idempotent.one-foreground-service", s, Boolean(sample.service.foreground), { service: sample.service });
    const wifi = (await c.probe.shell("dumpsys wifi").catch(() => "")).split("\n").filter((l) => /Multicaster\{uniclipboard-mdns/.test(l));
    c.assert("start-idempotent.single-multicast-lock", s, wifi.length === 1, { held: wifi });
    const owner = await ownerLog(c, since);
    c.assert("start-idempotent.no-extra-engine-hold", s, owner.filter((l) => /engine_owner retain/.test(l)).length === 0, { owner });
    const copiedAt = Date.now();
    await c.act.copyInOtherApp(`UCBG${c.runId}SIA`);
    const received = await timedReceive(c, `UCBG${c.runId}SIA`, `${s}-background`, copiedAt);
    c.assert("start-idempotent.sync-after-duplicates", s, received.ok, received);
  },

  // Failure mode: a missing permission must be shown as restricted, never as ready, and restoring it recovers.
  async "permission-missing"(c) {
    const s = "permission-missing";
    await ensureSetup(c);
    await freshProcess(c, s);
    await c.act.home();
    try {
      await c.probe.shell(`appops set ${c.appId} SYSTEM_ALERT_WINDOW deny`);
      const denied = await backgroundStateTexts(c);
      c.assert("permission-missing.shown-as-restricted", s, denied.some((t) => /still needs permission/i.test(t)) && !denied.some((t) => /^Ready$/.test(t)), { texts: denied.slice(0, 14) });
      const service = await c.probe.sample("permission-missing");
      c.assert("permission-missing.service-unaffected", s, Boolean(service.service.foreground), { service: service.service });
    } finally {
      await c.probe.shell(`appops set ${c.appId} SYSTEM_ALERT_WINDOW allow`).catch(() => "");
    }
    await c.act.home();
    const restored = await backgroundStateTexts(c);
    c.assert("permission-missing.recovers-when-granted", s, restored.some((t) => /^Ready$/.test(t)), { texts: restored.slice(0, 14) });
  },

  // The event-driven method (logcat trigger, needs READ_LOGS) as the person selects it in Settings.
  async "overlay-event"(c) {
    const s = "overlay-event";
    await ensureSetup(c);
    await freshProcess(c, s);
    const hasLogs = await c.probe.shell(`dumpsys package ${c.appId}`).then((t) => /READ_LOGS: granted=true/.test(t));
    c.assert("overlay-event.read-logs-held-on-this-image", s, hasLogs, { note: "userdebug emulator images grant it at install; a device without it cannot be reproduced here" });
    await c.runFlow("background-scenarios/select-clipboard-method.yaml", { METHOD_LABEL: "ADB events", BUTTON_LABEL: "Continue with.*|Use .*" });
    const texts = await c.probe.uiTexts();
    c.assert("overlay-event.selected-and-ready", s, texts.some((t) => /ADB events/.test(t)) && texts.some((t) => /^Ready$/.test(t)), { texts: texts.slice(0, 14) });
    // A person who picks the method then keeps using the phone: start from a fresh process with it persisted.
    await freshProcess(c, s);
    await c.act.home();
    await c.delay(8000);
    const outgoing = `UCBG${c.runId}OEv`;
    const copiedAt = Date.now();
    await c.act.copyInOtherApp(outgoing);
    const received = await timedReceive(c, outgoing, "overlay-event-background", copiedAt);
    // The native trigger chain (system denial line -> logcat_trigger -> triggered_read -> emit) is the evidence that
    // delivery came from the event method and not from polling.
    received.nativeChain = (await c.probe.clipboardLogs(copiedAt)).filter((l) => /triggered_read|emit /.test(l.message)).map((l) => l.message);
    if (!received.ok) {
      received.jsClipboardLogs = await c.probe.clipboardLogs(copiedAt);
      // The event method is triggered by the system's denial line naming this package; record whether it exists.
      const raw = await c.probe.run("logcat", "-d", "-v", "epoch", "-t", "5000", "ClipboardService:*", "*:S").catch(() => "");
      received.clipboardServiceLines = raw.split("\n").filter((l) => Number(l.match(/^\s*(\d+\.\d+)/)?.[1]) * 1000 >= copiedAt).map((l) => l.replace(/\s+/g, " ").slice(0, 200)).slice(0, 8);
    }
    c.assert("overlay-event.mobile-to-desktop-in-background", s, received.ok && received.latencyMs <= MOBILE_TO_DESKTOP_MS && received.nativeChain.some((m) => /triggered_read/.test(m)), received);
    // Leave the default method in place for whatever runs next.
    await c.runFlow("background-scenarios/select-clipboard-method.yaml", { METHOD_LABEL: "Timed polling", BUTTON_LABEL: "Continue with.*|Use .*" });
  },

  // Failure mode: Shizuku is the selected method but is not installed or running (the case on this emulator).
  async "shizuku-missing"(c) {
    const s = "shizuku-missing";
    await ensureSetup(c);
    await freshProcess(c, s);
    try {
      await c.runFlow("background-scenarios/select-clipboard-method.yaml", { METHOD_LABEL: "Shizuku", BUTTON_LABEL: "Continue with Shizuku" });
    } catch {
      // Continuing opens Shizuku's setup page in a browser, which can end the flow; the state is read below.
    }
    await c.probe.shell("am force-stop com.android.chrome").catch(() => "");
    await c.act.home();
    await c.probe.shell(`monkey -p ${c.appId} -c android.intent.category.LAUNCHER 1`).catch(() => "");
    await c.delay(4000);
    const texts = await backgroundStateTexts(c);
    c.assert("shizuku-missing.shown-as-restricted", s, texts.some((t) => /Shizuku is not running/i.test(t)) && !texts.some((t) => /^Ready$/.test(t)), { texts: texts.slice(0, 14) });
    const sample = await c.probe.sample("shizuku-missing");
    c.assert("shizuku-missing.service-unaffected", s, Boolean(sample.service.foreground), { service: sample.service });
    await c.runFlow("background-scenarios/select-clipboard-method.yaml", { METHOD_LABEL: "Timed polling", BUTTON_LABEL: "Continue with.*|Use .*" });
    const restored = await c.probe.uiTexts();
    c.assert("shizuku-missing.default-method-restored", s, restored.some((t) => /^Ready$/.test(t)), { texts: restored.slice(0, 14) });
  },

  // The Android 13+ log-access consent for the ADB-events method. Observed on API 36: a declined consent is asked
  // again at the next start, an accepted one persists across restarts, and a declined one leaves the method silent
  // (Settings still says Ready: the consent cannot be queried, and probing it by running logcat again re-prompts
  // and drops the persisted consent, which an earlier experiment showed).
  async "log-consent"(c) {
    const s = "log-consent";
    await ensureSetup(c);
    await freshProcess(c, s);
    const chainSince = async (since) =>
      (await c.probe.clipboardLogs(since)).filter((l) => /triggered_read|emit /.test(l.message)).map((l) => l.message);
    const copyAndWatch = async (suffix) => {
      const text = `UCBG${c.runId}${suffix}`;
      const at = Date.now();
      await c.act.copyInOtherApp(text);
      const received = await timedReceive(c, text, `${s}-${suffix}`, at);
      return { received, chain: await chainSince(at) };
    };
    const relaunch = async () => {
      await c.probe.shell(`am force-stop ${c.appId}`);
      await c.probe.shell(`am start -n ${c.appId}/app.uniclipboard.android.MainActivity`);
      await c.delay(12_000);
    };

    // 1. Decline at the first prompt.
    await c.runFlow("background-scenarios/select-clipboard-method.yaml", { METHOD_LABEL: "ADB events", BUTTON_LABEL: "Continue with.*|Use .*", CONSENT_BUTTON: "Don’t allow" });
    await c.act.home();
    await c.delay(ENGINE_ECHO_SETTLE_MS);
    const declined = await copyAndWatch("Deny");
    c.assert("log-consent.declined-gets-no-trigger", s, !declined.received.ok && !declined.chain.some((m) => /triggered_read/.test(m)), declined);
    const texts = await backgroundStateTexts(c);
    c.assert("log-consent.declined-ui-still-says-ready.known-gap", s, texts.some((t) => /^Ready$/.test(t)), { texts: texts.slice(0, 14) });

    // 2. The next start asks again; accepting makes the method work.
    await relaunch();
    const asked = await c.probe.uiTexts();
    c.assert("log-consent.declined-is-asked-again-at-next-start", s, asked.some((t) => /access all device logs/i.test(t)), { texts: asked.slice(0, 8) });
    await c.act.tapVisibleText("Allow one-time access");
    await c.peer.waitOnline("log-consent-allowed");
    await c.act.home();
    await c.delay(ENGINE_ECHO_SETTLE_MS);
    const allowed = await copyAndWatch("Allow");
    c.assert("log-consent.accepting-recovers", s, allowed.received.ok && allowed.chain.some((m) => /triggered_read/.test(m)), allowed);

    // 3. An accepted consent persists across a restart: no prompt, and the method still works.
    await relaunch();
    const again = await c.probe.uiTexts();
    c.assert("log-consent.accepted-is-not-asked-again", s, !again.some((t) => /access all device logs/i.test(t)), { texts: again.slice(0, 8) });
    await c.act.home();
    await c.delay(ENGINE_ECHO_SETTLE_MS);
    const persisted = await copyAndWatch("Kept");
    c.assert("log-consent.accepted-persists-across-restart", s, persisted.received.ok && persisted.chain.some((m) => /triggered_read/.test(m)), persisted);
    await c.runFlow("background-scenarios/select-clipboard-method.yaml", { METHOD_LABEL: "Timed polling", BUTTON_LABEL: "Continue with.*|Use .*" });
  },

  // Positive control for the permanent stop.
  async "notification-stop"(c) {
    const s = "notification-stop";
    await ensureSetup(c);
    await freshProcess(c, s);
    const before = Date.now() - 2000;
    await c.act.home();
    await c.act.tapNotificationAction("Stop");
    c.backgroundDisabledByStop = true;
    await c.delay(3000);
    const sample = await c.probe.sample("after-stop");
    c.assert("notification-stop.service-stopped", s, !sample.service.foreground, { sample });
    const events = await journalSince(c, before);
    c.assert("notification-stop.stop-recorded", s, stopEvents(events).length > 0, { events: stopEvents(events) });
  },
};
