#!/usr/bin/env node
// Desktop → phone LAN (SyncClipboard-compatible) acceptance on an OWNED, DISPOSABLE emulator
// against an isolated desktop peer's real Mobile LAN listener.
//
//   node e2e/lan-sync/run.mjs --app <apk> --peer-cli <uniclip> --label <name>
//        [--scenario a,b] [--samples 10] [--serial emulator-NNNN] [--out <dir>]
//
// The phone is configured through the real settings UI with unreachable addresses in front of the
// working one, as observed in the field. Unreachable addresses are dropped inside the emulator only
// (iptables), so nothing leaves the host. Every copy is a synthetic nonce, correlated across both
// ends by the desktop's content id. Output: run-manifest.json, timeline.json/csv, result.json.
import { createHash, randomInt, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { androidDevice } from "../environment/android.mjs";
import { command } from "../environment/process.mjs";
import { desktopPeer } from "../network/desktop-peer.mjs";
import { actions } from "../background/actions.mjs";
import { probe as createProbe } from "../background/probe.mjs";
import { badCandidateServer } from "./bad-candidates.mjs";
import { lanObserver } from "./observer.mjs";
import { BLACKHOLES, SCENARIOS } from "./scenarios.mjs";
import { contentAlias, readTraces, summarize } from "./timeline.mjs";
import { summarizeSegments } from "./segments.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sdk = process.env.ANDROID_HOME ?? join(homedir(), "Library/Android/sdk");
const maestro =
  process.env.MAESTRO_BIN ?? join(homedir(), ".local/share/mobile-e2e/2.10.0/maestro/bin/maestro");

function parse(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, "");
    if (!["app", "peer-cli", "label", "scenario", "serial", "out", "samples", "overlay"].includes(key) || !args[i + 1])
      throw new Error(`Invalid option: ${args[i]}`);
    options[key] = args[i + 1];
  }
  if (!options.app || !options["peer-cli"] || !options.label)
    throw new Error("Required: --app <apk> --peer-cli <uniclip> --label <name>");
  if (options.serial && !options.serial.startsWith("emulator-"))
    throw new Error("Refusing: only an owned emulator serial is accepted");
  return options;
}

const sha256 = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");

async function freePort() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const port = randomInt(43100, 43900);
    const ok = await new Promise((done) => {
      const server = createServer();
      server.once("error", () => done(false));
      server.listen(port, "0.0.0.0", () => server.close(() => done(true)));
    });
    if (ok) return port;
  }
  throw new Error("No free LAN test port");
}

async function main() {
  const options = parse(process.argv.slice(2));
  const app = resolve(options.app);
  const analyzer = join(sdk, "cmdline-tools/latest/bin/apkanalyzer");
  const appId = await command(analyzer, ["manifest", "application-id", app]);
  const names = options.scenario ? options.scenario.split(",") : Object.keys(SCENARIOS);
  for (const name of names) if (!SCENARIOS[name]) throw new Error(`Unknown scenario: ${name}`);

  const stamp = new Date().toISOString().replaceAll(":", "-");
  const output = resolve(options.out ?? join(root, "e2e/results", `${stamp}-lan-${options.label}`));
  await mkdir(output, { recursive: true });

  const device = options.serial
    ? { id: options.serial, metadata: { owned: "caller-created emulator" }, prepare: async () => {}, capture: async () => {}, dispose: async () => {} }
    : androidDevice({ app, output, network: "online" });
  const peer = desktopPeer(options["peer-cli"], output);
  let bad = badCandidateServer();
  const assertions = [];
  const samples = [];
  let probe, observer;
  // Further desktops a scenario adds (each its own profile, listener port and observer).
  const extraPeers = [];
  // SIGINT/SIGTERM must still release the owned emulator and peer; the default exit would skip
  // the finally block below.
  let interrupted = false;
  const onSignal = (signal) => {
    if (interrupted) return;
    interrupted = true;
    console.error(`Interrupted by ${signal}; releasing owned resources`);
    Promise.allSettled([
      observer?.stop(),
      bad.stop(),
      peer.dispose(),
      ...extraPeers.flatMap((p) => [p.observer?.stop(), p.peer.dispose()]),
      device.dispose(),
    ]).then(() =>
      process.exit(130)
    );
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    await device.prepare();
    probe = createProbe({ serial: device.id, appId });
    if (options.serial) {
      await probe.run("uninstall", appId).catch(() => "");
      await probe.run("install", app);
    }
    const fixtureApk = await command(join(root, "e2e/background/clipboard-fixture/build.sh"), [join(output, "clipboard-fixture-build")]);
    await probe.run("uninstall", "test.clipboardfixture").catch(() => "");
    await probe.run("install", fixtureApk.split("\n").at(-1));
    await probe.shell("settings put global hide_error_dialogs 1");
    // Keep the whole run's stage traces in the owned emulator's log buffer for phone-traces.jsonl.
    await probe.run("logcat", "-G", "16M").catch(() => "");
    await probe.run("root").catch(() => "");
    await delay(2000);
    for (const address of BLACKHOLES) {
      const rule = `OUTPUT -d ${address} -j DROP`;
      const present = await probe.shell(`iptables -C ${rule}`).then(() => true, () => false);
      if (!present) await probe.shell(`iptables -A ${rule}`);
    }
    await probe.shell("input keyevent KEYCODE_WAKEUP");
    await probe.shell(`pm grant ${appId} android.permission.POST_NOTIFICATIONS`).catch(() => "");
    // Background clipboard reads and writes need the overlay focus path, as on a configured phone.
    // `--overlay deny` keeps it off to show what happens without it.
    const overlay = options.overlay ?? "allow";
    await probe.shell(`appops set ${appId} SYSTEM_ALERT_WINDOW ${overlay === "deny" ? "deny" : "allow"}`);

    const port = await freePort();
    await peer.prepare({ invite: false });
    const phone = await peer.enableMobileLan({ port, label: "Emulator phone" });
    const observerCredential = await peer.addMobileCredential("Harness observer");
    observer = lanObserver({ port, credential: observerCredential, output });
    await observer.start();
    // A throwaway self-signed certificate for the HTTPS candidate; it stays in this run's output
    // and is trusted nowhere (no system or app trust store is changed).
    const tlsDir = join(output, "tls-throwaway");
    await mkdir(tlsDir, { recursive: true });
    await command("openssl", [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
      "-subj", "/CN=uniclip-lan-acceptance",
      "-addext", "subjectAltName=IP:10.0.2.2,IP:127.0.0.1",
      "-keyout", join(tlsDir, "key.pem"), "-out", join(tlsDir, "cert.pem"),
    ]);
    bad = badCandidateServer({
      peerPort: port,
      tls: { key: await readFile(join(tlsDir, "key.pem")), cert: await readFile(join(tlsDir, "cert.pem")) },
    });
    const badPorts = await bad.start();

    const manifest = {
      label: options.label,
      apk: { path: app, sha256: await sha256(app), applicationId: appId },
      source: {
        commit: await command("git", ["rev-parse", "HEAD"], { cwd: root }),
        dirty: (await command("git", ["status", "--short"], { cwd: root })).split("\n").filter(Boolean),
      },
      engine: JSON.parse(await readFile(join(root, "modules/uc-engine/core-source.json"), "utf8")),
      peer: {
        cli: options["peer-cli"],
        version: await command(options["peer-cli"], ["--version"]),
        cliSha256: await sha256(options["peer-cli"]),
        daemonSha256: await sha256(join(dirname(options["peer-cli"]), "uniclipd")),
      },
      device: {
        serial: device.id,
        sdk: await probe.shell("getprop ro.build.version.sdk"),
        model: await probe.shell("getprop ro.product.model"),
        ...device.metadata,
      },
      network: {
        working: "phone → 10.0.2.2 (emulator host alias) → isolated peer listener",
        blackholes: "two RFC 5737 addresses dropped inside the emulator",
        badCandidates: Object.keys(badPorts),
      },
      scenarios: names,
      overlayPermission: options.overlay ?? "allow",
      hostLoadAtStart: (await command("sysctl", ["-n", "vm.loadavg"])).trim(),
      samplesPerPhase: Number(options.samples ?? 10),
      rerun: `node e2e/lan-sync/run.mjs --app <apk> --peer-cli <uniclip> --label ${options.label} --scenario ${names.join(",")} --samples ${options.samples ?? 10}`,
      startedAt: new Date().toISOString(),
    };
    await writeFile(join(output, "run-manifest.json"), JSON.stringify(manifest, null, 2));

    let phase = 0;
    const redact = (text) =>
      [phone, ...extraPeers.map((p) => p.phone)].reduce(
        (out, credential) => (credential ? out.replaceAll(credential.password, "<redacted>") : out),
        text
      );
    const runFlow = async (file, variables = {}) => {
      const dir = join(output, `flow-${String(++phase).padStart(2, "0")}-${file.replace(/[/.]/g, "_")}`);
      await mkdir(dir, { recursive: true });
      // A loaded host can raise "System UI isn't responding" over the app; a person would wait.
      const texts = await probe.uiTexts().catch(() => []);
      if (texts.some((t) => /isn.t responding/i.test(t))) {
        await context.act.tapVisibleText("Wait");
        probe.event("system-dialog.waited", { file });
      }
      probe.event("flow.start", { file });
      const invoke = () =>
        command(
          maestro,
          [
            "--device", device.id, "test", "--format", "JUNIT", "--output", join(dir, "report.xml"),
            "--debug-output", dir, "--test-output-dir", dir,
            "-e", `APP_ID=${appId}`, "-e", "NETWORK_ACCEPTANCE=true",
            ...Object.entries(variables).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
            join(root, ".maestro", file),
          ],
          {
            env: { ...process.env, MAESTRO_CLI_NO_ANALYTICS: "1", MAESTRO_CLI_DISABLE_UPDATE_CHECK: "1" },
            cwd: root,
            timeout: 300_000,
          }
        );
      try {
        let log;
        try {
          log = await invoke();
        } catch (error) {
          // Maestro sometimes loses a loaded emulator before the flow starts. That is not a business
          // result: wait for the device and start the flow once more. Any other failure stands.
          if (!/is not connected/.test(`${error.stdout ?? ""}${error.stderr ?? ""}`)) throw error;
          probe.event("flow.device-reconnect", { file });
          await probe.run("wait-for-device");
          await delay(3000);
          log = await invoke();
        }
        // Flow variables may carry the throwaway credential; keep only Maestro's own log.
        await writeFile(join(dir, "maestro.log"), redact(log));
        probe.event("flow.end", { file, ok: true });
      } catch (error) {
        const text = `${error.stdout ?? ""}\n${error.stderr ?? ""}\n${error.message}`;
        await writeFile(join(dir, "maestro.log"), redact(text));
        probe.event("flow.end", { file, ok: false });
        throw error;
      }
    };

    const context = {
      appId,
      apkPath: app,
      overlay: options.overlay ?? "allow",
      probe,
      device,
      peer,
      phone,
      port,
      badPorts,
      bad,
      observer,
      runFlow,
      /** A second, independent desktop with its own Mobile LAN listener and phone credential. */
      async addPeer(name) {
        const dir = join(output, `peer-${name}`);
        await mkdir(dir, { recursive: true });
        const extra = { name, peer: desktopPeer(options["peer-cli"], dir, { deviceName: `Acceptance peer ${name}` }) };
        extraPeers.push(extra);
        extra.port = await freePort();
        await extra.peer.prepare({ invite: false });
        extra.phone = await extra.peer.enableMobileLan({ port: extra.port, label: "Emulator phone" });
        extra.observer = lanObserver({
          port: extra.port,
          credential: await extra.peer.addMobileCredential("Harness observer"),
          output: dir,
        });
        await extra.observer.start();
        return extra;
      },
      act: actions({ probe, appId }),
      output,
      runId: randomUUID().slice(0, 6),
      samplesPerPhase: Number(options.samples ?? 10),
      delay,
      samples,
      contentAlias,
      readTraces: (sinceHostMs) => readTraces(probe, sinceHostMs),
      assert(id, scenario, ok, detail = {}) {
        assertions.push({ id, scenario, status: ok ? "pass" : "fail", ...detail });
        probe.event("assert", { id, scenario, status: ok ? "pass" : "fail" });
      },
      notRun(id, scenario, reason) {
        assertions.push({ id, scenario, status: "not-run", reason });
      },
    };

    for (const name of names) {
      probe.event("scenario.start", { name });
      try {
        await SCENARIOS[name](context);
      } catch (error) {
        context.assert(`${name}.completed`, name, false, { error: error.message.slice(0, 300) });
      }
      probe.event("scenario.end", { name });
    }
  } finally {
    const result = {
      assertions,
      phases: summarize(samples),
      segments: Object.fromEntries(
        [...new Set(samples.map((s) => s.phase))].map((phase) => [
          phase,
          summarizeSegments(samples.filter((s) => s.phase === phase && s.ok)),
        ])
      ),
      hostLoadAtEnd: (await command("sysctl", ["-n", "vm.loadavg"]).catch(() => "")).trim(),
      sampleCount: samples.length,
      finishedAt: new Date().toISOString(),
    };
    await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
    await writeFile(join(output, "timeline.json"), JSON.stringify(samples, null, 2));
    const columns = ["phase", "seq", "alias", "ok", "restoreRequestToAppliedMs", "activationToAppliedMs", "activationToSseMs", "sseToAppliedMs", "appliedToHistoryMs", "getAttempts", "clockOffsetMs", "clockErrorMs", "note"];
    await writeFile(
      join(output, "timeline.csv"),
      [columns.join(","), ...samples.map((s) => columns.map((k) => JSON.stringify(s[k] ?? "")).join(","))].join("\n") + "\n"
    );
    // Phone stage traces (roles, aliases, timings) and the reply-lost proxy's connection log are
    // kept with the run; the emulator and its logcat are gone after dispose.
    if (probe) {
      const traces = await readTraces(probe, 0).catch(() => []);
      await writeFile(join(output, "phone-traces.jsonl"), traces.map((t) => JSON.stringify(t)).join("\n"));
    }
    await writeFile(join(output, "put-lost-connections.json"), JSON.stringify(bad.putLostLog ?? [], null, 2));
    await writeFile(join(output, "tls-handshake-failures.json"), JSON.stringify(bad.tlsHandshakeFailures ?? [], null, 2));
    if (probe) {
      await writeFile(join(output, "harness-events.jsonl"), probe.timeline.map((e) => JSON.stringify(e)).join("\n"));
      await device.capture().catch(() => {});
    }
    await observer?.stop().catch(() => {});
    await bad.stop().catch(() => {});
    await peer.dispose().catch(() => {});
    for (const extra of extraPeers) {
      await extra.observer?.stop().catch(() => {});
      await extra.peer.dispose().catch(() => {});
    }
    await device.dispose().catch(() => {});
    const sums = [];
    for (const f of ["run-manifest.json", "timeline.json", "timeline.csv", "result.json"]) {
      try {
        sums.push(`${await sha256(join(output, f))}  ${f}`);
      } catch {}
    }
    await writeFile(join(output, "SHA256SUMS"), `${sums.join("\n")}\n`);
  }
  const failed = assertions.filter((a) => a.status === "fail");
  console.log(`Results: ${output}`);
  console.log(`${assertions.filter((a) => a.status === "pass").length} pass, ${failed.length} fail, ${assertions.filter((a) => a.status === "not-run").length} not-run`);
  for (const a of failed) console.log(`FAIL ${a.scenario}/${a.id}`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
