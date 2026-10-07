#!/usr/bin/env node
// Android power-metrics acceptance on an OWNED, DISPOSABLE emulator only.
// It changes device-global state (battery, Doze, network, reboot), so non-emulator serials are refused.
// Usage: node e2e/power/run.mjs --apk <debuggable apk> --serial emulator-5580 --out <dir> [--phase-seconds 120]
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { aggregatePowerSamples, parsePowerSamples } from "../../src/support/power/aggregatePowerSamples.ts";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith("--") ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const serial = args.serial;
if (!serial?.startsWith("emulator-")) throw new Error("Refusing: only an owned emulator serial is accepted");
const apk = resolve(args.apk);
const out = resolve(args.out);
const phaseMs = Number(args["phase-seconds"] ?? 120) * 1000;
const root = resolve(new URL("../..", import.meta.url).pathname);
mkdirSync(out, { recursive: true });

const adbBin = `${process.env.ANDROID_HOME ?? `${process.env.HOME}/Library/Android/sdk`}/platform-tools/adb`;
const adb = (...a) => execFileSync(adbBin, ["-s", serial, ...a], { encoding: "utf8", maxBuffer: 64 << 20 });
const sh = (cmd) => adb("shell", cmd);
const PKG = "app.uniclipboard.android.dev";
const log = (m) => { console.log(`[${new Date().toISOString()}] ${m}`); };
const phases = [];
const mark = (name) => { phases.push({ name, at: new Date().toISOString(), elapsedMs: Math.round(Number(sh("cat /proc/uptime").split(" ")[0]) * 1000) }); log(`phase ${name}`); };
const maestro = (flow, env = {}) => {
  const r = spawnSync(`${process.env.HOME}/.maestro/bin/maestro`, ["--device", serial, "test", ...Object.entries({ APP_ID: PKG, ...env }).flatMap(([k, v]) => ["-e", `${k}=${v}`]), join(root, flow)],
    { encoding: "utf8", cwd: out, env: { ...process.env, MAESTRO_CLI_NO_ANALYTICS: "1", MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: "true" } });
  writeFileSync(join(out, `maestro-${flow.replaceAll("/", "_")}.log`), r.stdout + r.stderr);
  // Maestro keeps screenshots in its own results folder (newest run); copy them next to the other evidence.
  spawnSync("sh", ["-c", `d=$(ls -td "$HOME"/.maestro/tests/*/ | head -1); find "$d" -name '*.png' -exec cp {} "${out}/" \\;`]);
  if (r.status !== 0) throw new Error(`maestro flow failed: ${flow}`);
};
const samples = () => parsePowerSamples(sh(`run-as ${PKG} cat files/power-metrics/samples.jsonl`));
const launch = () => sh(`am start -n ${PKG}/app.uniclipboard.android.MainActivity`);
const home = () => sh("input keyevent KEYCODE_HOME");

// --- identity: everything needed to rerun and to trust the numbers ---
const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
const env = {
  sourceCommit: git("rev-parse", "HEAD"), dirty: git("status", "--porcelain").split("\n").filter(Boolean),
  enginePin: JSON.parse(readFileSync(join(root, "modules/uc-engine/core-source.json"), "utf8")),
  apkSha256: createHash("sha256").update(readFileSync(apk)).digest("hex"),
  device: { serial, model: sh("getprop ro.product.model").trim(), fingerprint: sh("getprop ro.build.fingerprint").trim(), sdk: sh("getprop ro.build.version.sdk").trim(), abi: sh("getprop ro.product.cpu.abi").trim(), qemu: sh("getprop ro.kernel.qemu").trim() },
  startedAt: new Date().toISOString(), phaseSeconds: phaseMs / 1000,
  note: "Emulator battery hardware is synthetic: this run validates semantics, not energy precision.",
};
writeFileSync(join(out, "environment.json"), JSON.stringify(env, null, 2));
if (env.device.qemu !== "1" && !serial.startsWith("emulator-")) throw new Error("not an emulator");

// --- setup ---
try { adb("uninstall", PKG); } catch { /* not installed */ }
adb("install", "-r", apk);
sh(`pm grant ${PKG} android.permission.POST_NOTIFICATIONS`);
sh("dumpsys battery reset");
mark("setup");
launch(); await delay(8000);
maestro(".maestro/power-scenarios/setup.yaml");
if (args["no-space"] !== "true") { mark("create-space"); maestro(".maestro/power-scenarios/space.yaml"); await delay(20000); }
const uid = sh(`pm list packages -U ${PKG}`).match(/uid:(\d+)/)[1];

const procThreadCpu = (pid, name) => { // CPU ticks of a named thread from /proc: independent of the app's own accounting
  let ticks = 0;
  for (const line of sh(`cat /proc/${pid}/task/*/stat`).split("\n")) {
    if (!line.includes(`(${name})`)) continue;
    const f = line.split(") ")[1].split(" ");
    ticks += Number(f[11]) + Number(f[12]);
  }
  return ticks;
};
const procCpu = () => { const pid = sh(`pidof ${PKG}`).trim().split(" ")[0]; const f = sh(`cat /proc/${pid}/stat`).split(") ")[1].split(" "); return { pid, ticks: Number(f[11]) + Number(f[12]), monitorTicks: procThreadCpu(pid, "uc-power-metric"), at: Date.now() }; };

// --- phases ---
sh("dumpsys battery unplug"); sh("dumpsys battery set level 90"); await delay(2000);
mark("foreground-idle"); launch(); await delay(phaseMs);
mark("background-screen-on"); home(); await delay(phaseMs);
sh("dumpsys battery set level 89");
mark("background-screen-off"); sh("input keyevent KEYCODE_SLEEP"); await delay(phaseMs);
mark("doze-forced"); sh("dumpsys deviceidle force-idle"); await delay(phaseMs / 2);
sh("dumpsys deviceidle unforce"); sh("input keyevent KEYCODE_WAKEUP"); sh("wm dismiss-keyguard"); await delay(2000);
mark("charging"); sh("dumpsys battery set ac 1"); sh("dumpsys battery set level 92"); await delay(phaseMs / 2);
mark("unplugged-again"); sh("dumpsys battery unplug"); sh("dumpsys battery set level 91"); await delay(phaseMs / 2);
mark("offline"); sh("svc wifi disable"); sh("svc data disable"); await delay(phaseMs / 2);
mark("online"); sh("svc wifi enable"); sh("svc data enable"); await delay(phaseMs / 2);

// --- calibration: bracket a quiet screen-off window with two boundary samples and compare with the OS's own accounting ---
mark("calibration"); home(); await delay(1500);
sh("input keyevent KEYCODE_SLEEP"); await delay(1500);           // boundary sample A: screen.off
const uidLinesOf = (text) => text.split("\n").filter((l) => l.startsWith(`9,${uid},`));
// `--poll` makes the OS fold pending kernel counters into its stats before dumping (independent of TrafficStats reads).
const netstatsOf = () => adb("shell", "dumpsys netstats --poll detail");
writeFileSync(join(out, "netstats-start.txt"), netstatsOf());
const checkinStart = adb("shell", "dumpsys batterystats --checkin");   // deltas of two exports avoid relying on reset semantics
const calA = procCpu();
await delay(Math.max(phaseMs, 60000));
const calB = procCpu();
sh("input keyevent KEYCODE_WAKEUP");                              // boundary sample B: screen.on
const checkinCal = adb("shell", "dumpsys batterystats --checkin");
writeFileSync(join(out, "netstats-end.txt"), netstatsOf());
writeFileSync(join(out, "batterystats-checkin-start.txt"), checkinStart);
writeFileSync(join(out, "batterystats-checkin-calibration.txt"), checkinCal);
const calUid = uidLinesOf(checkinCal);
const calUidStart = uidLinesOf(checkinStart);
writeFileSync(join(out, "batterystats-uid-calibration.txt"), `# start\n${calUidStart.join("\n")}\n# end\n${calUid.join("\n")}\n`);
sh("wm dismiss-keyguard"); await delay(1500);
const calSamples = samples().samples;
// Both boundaries must come from this calibration window and the same process; otherwise the deltas describe another window.
const calStartWall = Date.parse(phases.find((p) => p.name === "calibration").at);
const inWindow = calSamples.filter((s) => s.wallMs >= calStartWall - 2000);
const sampleA = inWindow.find((s) => s.reason === "screen.off");
const sampleB = [...inWindow].reverse().find((s) => s.reason === "screen.on");
const calibrationValid = Boolean(sampleA && sampleB && sampleB.seq > sampleA.seq && sampleA.epoch.pid === sampleB.epoch.pid && sampleA.epoch.boot === sampleB.epoch.boot);

mark("overview-ui"); launch(); await delay(3000);
const uiResults = {};
const ui = (name, flow, env) => { try { maestro(flow, env); uiResults[name] = "passed"; } catch (e) { uiResults[name] = `failed: ${e.message}`; } };
ui("overview", ".maestro/power-scenarios/overview.yaml", { SHOT: "overview" });
writeFileSync(join(out, "samples-before-faults.jsonl"), sh(`run-as ${PKG} cat files/power-metrics/samples.jsonl`));

// --- failure modes: process death, reboot, reset ---
mark("process-crashed"); home(); await delay(1000); sh(`am crash ${PKG}`); await delay(6000); launch(); await delay(8000);
mark("force-stopped"); sh(`am force-stop ${PKG}`); await delay(3000); launch(); await delay(8000);
const monitorBeforeReboot = procCpu();
const stepCost = (list) => { // marginal cost of one sample inside one process: successive differences of the cumulative counters
  const cpu = [], wall = [];
  const byPid = {};
  for (const s of list) (byPid[s.epoch.pid] ??= []).push(s);
  for (const group of Object.values(byPid)) for (let i = 1; i < group.length; i++) { cpu.push((group[i].self.cpuUs - group[i - 1].self.cpuUs) / 1000); wall.push((group[i].self.costUs - group[i - 1].self.costUs) / 1000); }
  const q = (xs, p) => xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))] : null;
  return { n: cpu.length, cpuMs: { median: q(cpu, .5), p90: q(cpu, .9), max: q(cpu, 1) }, wallMs: { median: q(wall, .5), p90: q(wall, .9), max: q(wall, 1) } };
};
const preReboot = samples();
const selfBeforeReboot = preReboot.samples.at(-1)?.self ?? null;
mark("reboot"); adb("reboot"); adb("wait-for-device"); for (let i = 0; i < 90 && sh("getprop sys.boot_completed").trim() !== "1"; i++) await delay(2000);
await delay(10000); sh("input keyevent KEYCODE_WAKEUP"); sh("wm dismiss-keyguard"); launch(); await delay(10000);
mark("overview-after-restarts");
ui("overviewAfterRestarts", ".maestro/power-scenarios/overview.yaml", { SHOT: "overview-after-restarts" });
// Export through the real UI path (system folder picker -> Documents), then inspect the actual archive.
sh("rm -f /sdcard/Documents/uniclip_diagnostics_*.zip");
ui("exportArchive", ".maestro/actions/diagnostics/export.yaml");
const exported = sh("ls /sdcard/Documents").split(/\r?\n/).filter((n) => /^uniclip_diagnostics_[0-9_-]+\.zip$/.test(n));
let archiveCheck = { status: "missing" };
if (exported.length) {
  adb("pull", `/sdcard/Documents/${exported[0]}`, join(out, exported[0]));
  const { unzipSync, strFromU8 } = await import("fflate");
  const entries = unzipSync(readFileSync(join(out, exported[0])));
  const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
  const exportedSamples = parsePowerSamples(strFromU8(entries["power/samples.jsonl"] ?? new Uint8Array()));
  archiveCheck = {
    status: "present", file: exported[0], entries: Object.keys(entries).filter((n) => n.startsWith("power/")),
    manifestPowerMetrics: manifest.powerMetrics ?? manifest.sources?.powerMetrics ?? Object.values(manifest).find((v) => v && typeof v === "object" && "powerMetrics" in v)?.powerMetrics ?? null,
    exportedSampleCount: exportedSamples.samples.length, exportedMalformed: exportedSamples.malformed,
    rawLeaks: ["clipboard", "passphrase", "RelayE2E"].filter((w) => strFromU8(entries["power/samples.jsonl"] ?? new Uint8Array()).includes(w)),
  };
}
const all = samples();
writeFileSync(join(out, "samples.jsonl"), sh(`run-as ${PKG} cat files/power-metrics/samples.jsonl`));
mark("reset-ui");
ui("reset", ".maestro/power-scenarios/reset.yaml", { SHOT: "reset" });
const afterReset = samples();
// Nothing from before the reset may survive: the first sample is `reset` and everything after it is the UI's own `query`.
const afterResetReasons = afterReset.samples.map((x) => x.reason);
uiResults.resetEffect = afterResetReasons[0] === "reset" && afterResetReasons.slice(1).every((r) => r === "query") ? "passed" : `failed: ${afterResetReasons.join(",")}`;

// --- derive ---
const ticks = Number(sh("getconf CLK_TCK").trim() || 100);
const pick = (lines, key) => lines.find((l) => l.split(",")[3] === key)?.split(",");
const uidCpu = pick(calUid, "cpu"); const uidCpuStart = pick(calUidStart, "cpu");
const uidNetwork = pick(calUid, "nt"); const uidNetworkStart = pick(calUidStart, "nt");
const calibration = {
  valid: calibrationValid,
  windowSamples: calibrationValid ? { from: sampleA.reason, to: sampleB.reason, elapsedMs: sampleB.elapsedMs - sampleA.elapsedMs,
    recordedProcessCpuMs: sampleB.app.cpuMs - sampleA.app.cpuMs,
    recordedHealthWakeMs: [sampleA.app.health?.wakeMs ?? null, sampleB.app.health?.wakeMs ?? null],
    recordedNet: { rx: sampleB.app.rxBytes - sampleA.app.rxBytes, tx: sampleB.app.txBytes - sampleA.app.txBytes } } : null,
  procStatCpuMsBetweenAdbReads: (calB.ticks - calA.ticks) * 1000 / ticks,
  recordedHealthStatsCpuMs: calibrationValid ? { user: [sampleA.app.health?.cpuUserMs ?? null, sampleB.app.health?.cpuUserMs ?? null], system: [sampleA.app.health?.cpuSysMs ?? null, sampleB.app.health?.cpuSysMs ?? null] } : null,
  batterystatsUidDelta: {
    cpuUserMs: uidCpu && uidCpuStart ? Number(uidCpu[4]) - Number(uidCpuStart[4]) : null,
    cpuSystemMs: uidCpu && uidCpuStart ? Number(uidCpu[5]) - Number(uidCpuStart[5]) : null,
    networkLineStart: uidNetworkStart?.slice(4).join(",") ?? null, networkLineEnd: uidNetwork?.slice(4).join(",") ?? null, rawFile: "batterystats-uid-calibration.txt",
  },
  note: "Two `dumpsys batterystats --checkin` exports bracket the window between boundary samples A (screen.off) and B (screen.on); device unplugged; the OS counts on-battery time only.",
};
const preFaultAgg = aggregatePowerSamples(parsePowerSamples(readFileSync(join(out, "samples-before-faults.jsonl"), "utf8")).samples);
const allAgg = aggregatePowerSamples(all.samples, { malformed: all.malformed });
const monitorCpuMsProc = monitorBeforeReboot.monitorTicks * 1000 / ticks;
const result = {
  env, phases, uid, uiResults, archiveCheck,
  samples: { total: all.samples.length, malformed: all.malformed, reasons: Object.fromEntries([...new Set(all.samples.map((s) => s.reason))].map((r) => [r, all.samples.filter((s) => s.reason === r).length])) },
  aggregateBeforeFaults: preFaultAgg, aggregateAll: allAgg, calibration,
  prevExits: all.samples.filter((s) => s.prevExit).map((s) => ({ seq: s.seq, pid: s.epoch.pid, boot: s.epoch.boot, prevExit: s.prevExit })),
  afterReset: { sampleCount: afterReset.samples.length, reasons: afterReset.samples.map((s) => s.reason) },
  overhead: selfBeforeReboot ? {
    selfReported: selfBeforeReboot, costUsPerSample: selfBeforeReboot.costUs / selfBeforeReboot.samples, cpuUsPerSample: selfBeforeReboot.cpuUs / selfBeforeReboot.samples,
    binderCallsPerSample: selfBeforeReboot.binderCalls / selfBeforeReboot.samples,
    marginalPerSample: stepCost(parsePowerSamples(readFileSync(join(out, "samples-before-faults.jsonl"), "utf8")).samples),
    monitorThreadCpuMsFromProc: monitorCpuMsProc, appProcessCpuMsFromProc: monitorBeforeReboot.ticks * 1000 / ticks,
    note: "thread CPU read from /proc/<pid>/task/*/stat for the uc-power-metrics thread, of the process alive before reboot",
  } : null,
};
writeFileSync(join(out, "result.json"), JSON.stringify(result, null, 2));
writeFileSync(join(out, "phases.json"), JSON.stringify(phases, null, 2));
sh("dumpsys battery reset");
// A run is only accepted when every required check passed; evidence is written first so failures stay inspectable.
const failures = [
  ...Object.entries(uiResults).filter(([, v]) => v !== "passed").map(([k, v]) => `ui ${k}: ${v}`),
  ...(archiveCheck.status === "present" && archiveCheck.entries.length >= 2 && archiveCheck.exportedMalformed === 0 && archiveCheck.rawLeaks.length === 0 ? [] : [`archive: ${JSON.stringify(archiveCheck)}`]),
  ...(calibration.valid ? [] : ["calibration boundaries missing or from different windows"]),
  ...(result.samples.malformed === 0 ? [] : [`${result.samples.malformed} malformed samples`]),
];
writeFileSync(join(out, "failures.json"), JSON.stringify(failures, null, 2));
if (failures.length) { console.error(`FAILED:\n${failures.join("\n")}`); process.exitCode = 1; }
log(`${failures.length ? "finished with failures" : "done"}: ${out}`);
