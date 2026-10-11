#!/usr/bin/env node
// Android background-sync acceptance on an OWNED, DISPOSABLE emulator with an isolated desktop peer.
//
//   node e2e/background/run.mjs --app <apk> --peer-cli <uniclip> --label <name> [--scenario <name>]
//        [--serial emulator-NNNN]   reuse an emulator you created yourself (never a physical device)
//
// Every scenario asserts the intended behaviour, so running it against an older APK records
// exactly which signals fail there. Output: manifest.json, timeline.jsonl, assertions.json,
// SHA256SUMS. Clipboard fixtures are synthetic; nothing here reads real user data.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { androidDevice } from "../environment/android.mjs";
import { command } from "../environment/process.mjs";
import { desktopPeer } from "../network/desktop-peer.mjs";
import { actions } from "./actions.mjs";
import { probe as createProbe } from "./probe.mjs";
import { SCENARIOS } from "./scenarios.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sdk = process.env.ANDROID_HOME ?? join(homedir(), "Library/Android/sdk");
const maestro =
  process.env.MAESTRO_BIN ?? join(homedir(), ".local/share/mobile-e2e/2.10.0/maestro/bin/maestro");

function parse(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, "");
    if (!["app", "peer-cli", "label", "scenario", "serial", "out", "rounds"].includes(key) || !args[i + 1])
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

async function main() {
  const options = parse(process.argv.slice(2));
  const app = resolve(options.app);
  const analyzer = join(sdk, "cmdline-tools/latest/bin/apkanalyzer");
  const appId = await command(analyzer, ["manifest", "application-id", app]);
  const names = options.scenario ? options.scenario.split(",") : Object.keys(SCENARIOS);
  for (const name of names) if (!SCENARIOS[name]) throw new Error(`Unknown scenario: ${name}`);

  const stamp = new Date().toISOString().replaceAll(":", "-");
  const output = resolve(options.out ?? join(root, "e2e/results", `${stamp}-background-${options.label}`));
  await mkdir(output, { recursive: true });

  const device = options.serial
    ? { id: options.serial, metadata: { owned: "caller-created emulator" }, prepare: async () => {}, capture: async () => {}, dispose: async () => {} }
    : androidDevice({ app, output, network: "online" });
  const assertions = [];
  const peer = desktopPeer(options["peer-cli"], output);
  let probe;
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
    // An owned emulator on a loaded host raises "System UI isn't responding" dialogs that hide the app.
    await probe.shell("settings put global hide_error_dialogs 1");
    // Lets the harness start the non-exported restart prompt directly; only emulator images allow it.
    await probe.run("root").catch(() => "");
    await delay(1500);
    await probe.shell("input keyevent KEYCODE_WAKEUP");
    await probe.shell(`pm grant ${appId} android.permission.POST_NOTIFICATIONS`);
    await probe.shell(`appops set ${appId} SYSTEM_ALERT_WINDOW allow`);

    const manifest = {
      label: options.label,
      apk: { path: app, sha256: await sha256(app), applicationId: appId },
      source: {
        commit: await command("git", ["rev-parse", "HEAD"], { cwd: root }),
        dirty: (await command("git", ["status", "--short"], { cwd: root })).split("\n").filter(Boolean),
      },
      engine: JSON.parse(await readFile(join(root, "modules/uc-engine/core-source.json"), "utf8")),
      peerCli: await command(options["peer-cli"], ["--version"]),
      device: {
        serial: device.id,
        sdk: await probe.shell("getprop ro.build.version.sdk"),
        release: await probe.shell("getprop ro.build.version.release"),
        abi: await probe.shell("getprop ro.product.cpu.abi"),
        model: await probe.shell("getprop ro.product.model"),
        targetSdk: await command(analyzer, ["manifest", "target-sdk", app]),
        ...device.metadata,
      },
      scenarios: names,
      startedAt: new Date().toISOString(),
    };
    await writeFile(join(output, "manifest.json"), JSON.stringify(manifest, null, 2));

    let phase = 0;
    const runFlow = async (file, variables = {}) => {
      const dir = join(output, `flow-${String(++phase).padStart(2, "0")}-${file.replace(/[/.]/g, "_")}`);
      await mkdir(dir, { recursive: true });
      probe.event("flow.start", { file });
      try {
        const log = await command(
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
        await writeFile(join(dir, "maestro.log"), log);
        probe.event("flow.end", { file, ok: true });
      } catch (error) {
        await writeFile(join(dir, "maestro.log"), `${error.stdout ?? ""}\n${error.stderr ?? ""}\n${error.message}`);
        probe.event("flow.end", { file, ok: false });
        throw error;
      }
    };

    const context = {
      appId,
      probe,
      appApk: app,
      device,
      peer,
      runFlow,
      act: actions({ probe, appId }),
      output,
      runId: randomUUID().slice(0, 8),
      rounds: Number(options.rounds ?? 1),
      delay,
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
        context.assert(`${name}.completed`, name, false, { error: error.message });
      }
      probe.event("scenario.end", { name });
    }
    const journal = await probe.journal();
    await writeFile(join(output, "service-log.txt"), await probe.serviceLog());
    await writeFile(join(output, "native-journal.jsonl"), journal.map((e) => JSON.stringify(e)).join("\n"));
  } finally {
    if (probe) {
      await writeFile(join(output, "timeline.jsonl"), probe.timeline.map((e) => JSON.stringify(e)).join("\n"));
      await device.capture().catch(() => {});
    }
    await writeFile(join(output, "assertions.json"), JSON.stringify(assertions, null, 2));
    await peer.dispose().catch(() => {});
    await device.dispose().catch(() => {});
    const sums = [];
    for (const f of ["manifest.json", "timeline.jsonl", "assertions.json", "native-journal.jsonl"]) {
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
