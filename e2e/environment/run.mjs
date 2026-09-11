import {
  mkdir,
  readdir,
  realpath,
  writeFile,
  stat,
  mkdtemp,
  rm,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { decodeSimulatorEntitlements } from "./entitlements.mjs";
import { parseOptions, validateDeviceBudget } from "./options.mjs";
import { command } from "./process.mjs";
import { runScenario } from "./lifecycle.mjs";
import { iosDevice } from "./ios.mjs";
import { androidDevice } from "./android.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const version = "2.10.0";
const maestro =
  process.env.MAESTRO_BIN ??
  join(homedir(), `.local/share/mobile-e2e/${version}/maestro/bin/maestro`);
const env = {
  ...process.env,
  MAESTRO_CLI_NO_ANALYTICS: "1",
  MAESTRO_CLI_DISABLE_UPDATE_CHECK: "1",
};
const interrupted = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => interrupted.abort(new Error(signal)));

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const app = await realpath(options.app);
  if (
    options.platform === "ios"
      ? !(await stat(app)).isDirectory() || !app.endsWith(".app")
      : !app.endsWith(".apk")
  )
    throw new Error("Expected Simulator .app directory or Android .apk");
  if (
    (await command(maestro, ["--version"], { env })).split(/\r?\n/).at(-1) !==
    version
  )
    throw new Error(`Install Maestro ${version}; see e2e/README.md`);
  let appId, appVersion;
  if (options.platform === "ios") {
    appId = await command("/usr/libexec/PlistBuddy", [
      "-c",
      "Print :CFBundleIdentifier",
      join(app, "Info.plist"),
    ]);
    appVersion = await command("/usr/libexec/PlistBuddy", [
      "-c",
      "Print :CFBundleVersion",
      join(app, "Info.plist"),
    ]);
    const info = JSON.parse(
      await command("plutil", [
        "-convert",
        "json",
        "-o",
        "-",
        join(app, "Info.plist"),
      ])
    );
    const temp = await mkdtemp(join(tmpdir(), "uniclip-e2e-entitlements-"));
    try {
      const xml = decodeSimulatorEntitlements(
        await command("otool", [
          "-arch",
          "arm64",
          "-s",
          "__TEXT",
          "__entitlements",
          join(app, info.CFBundleExecutable),
        ])
      );
      if (!xml.trim())
        throw new Error(
          "Simulator App has no entitlements; build with ad-hoc signing enabled (see e2e/README.md)"
        );
      const file = join(temp, "entitlements.plist");
      await writeFile(file, xml);
      const entitlements = JSON.parse(
        await command("plutil", ["-convert", "json", "-o", "-", file])
      );
      if (
        !info.UCAppGroupIdentifier ||
        !entitlements["com.apple.security.application-groups"]?.includes(
          info.UCAppGroupIdentifier
        )
      ) {
        throw new Error(
          "Simulator App is missing its configured App Group entitlement"
        );
      }
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
    if (!(await stat(join(app, "main.jsbundle")).catch(() => null)))
      throw new Error(
        "App must contain main.jsbundle; build Release without Metro"
      );
  } else {
    const sdk =
      process.env.ANDROID_HOME ?? join(homedir(), "Library/Android/sdk");
    const analyzer = join(sdk, "cmdline-tools/latest/bin/apkanalyzer");
    appId = await command(analyzer, ["manifest", "application-id", app]);
    appVersion = await command(analyzer, ["manifest", "version-code", app]);
    const files = await command(analyzer, ["files", "list", app]);
    if (!files.includes("assets/index.android.bundle"))
      throw new Error("APK must contain bundled JavaScript; build Release");
  }
  const scenarios = (await readdir(join(root, ".maestro/scenarios")))
    .filter((f) => /^[a-z][a-z0-9-]*\.yaml$/.test(f))
    .sort();
  const selected = options.scenario
    ? scenarios.filter((f) => f === `${options.scenario}.yaml`)
    : scenarios;
  if (!selected.length) throw new Error("No matching scenarios");
  validateDeviceBudget(options.platform, selected.length, options.repeat);
  const runOutput = join(
    root,
    "e2e/results",
    `${new Date().toISOString().replaceAll(":", "-")}-${options.platform}-${
      process.pid
    }`
  );
  await mkdir(runOutput, { recursive: true });
  const summary = {
    app,
    appId,
    appVersion,
    maestro: version,
    revision: await command("git", ["rev-parse", "HEAD"], { cwd: root }),
    results: [],
  };
  for (let round = 1; round <= options.repeat; round++) {
    for (const scenario of selected) {
      if (interrupted.signal.aborted) break;
      const output = join(
        runOutput,
        `${round}-${scenario.replace(".yaml", "")}`
      );
      await mkdir(output);
      const device = (options.platform === "ios" ? iosDevice : androidDevice)({
        app,
        output,
      });
      const captureDevice = device.capture.bind(device);
      device.capture = async () => {
        const captures = await Promise.allSettled([
          captureDevice(),
          device.id
            ? command(maestro, ["--device", device.id, "hierarchy"], {
                env,
                timeout: 45_000,
              }).then((tree) => writeFile(join(output, "hierarchy.txt"), tree))
            : Promise.resolve(),
        ]);
        const failures = captures
          .filter((r) => r.status === "rejected")
          .map((r) => r.reason.message);
        if (failures.length) {
          await writeFile(
            join(output, "capture-errors.txt"),
            failures.join("\n")
          );
          throw new Error(failures.join("\n"));
        }
      };
      console.log(`[${options.platform}] round ${round}: ${scenario}`);
      const result = await runScenario(device, async () => {
        interrupted.signal.throwIfAborted();
        await writeFile(
          join(output, "device.json"),
          JSON.stringify({ id: device.id, ...device.metadata }, null, 2)
        );
        try {
          const log = await command(
            maestro,
            [
              "--device",
              device.id,
              "test",
              "--format",
              "JUNIT",
              "--output",
              join(output, "report.xml"),
              "--debug-output",
              output,
              "--test-output-dir",
              output,
              "-e",
              `APP_ID=${appId}`,
              join(root, ".maestro/scenarios", scenario),
            ],
            { env, cwd: root, timeout: 300_000, signal: interrupted.signal }
          );
          await writeFile(join(output, "maestro.log"), log);
        } catch (error) {
          await writeFile(
            join(output, "maestro.log"),
            `${error.stdout ?? ""}\n${error.stderr ?? ""}\n${error.message}`
          );
          throw error;
        }
      });
      summary.results.push({
        scenario,
        round,
        ...result,
        output,
        device: device.metadata,
      });
      await writeFile(
        join(runOutput, "summary.json"),
        JSON.stringify(summary, null, 2)
      );
      console.log(
        `${result.ok ? "PASS" : "FAIL"}: ${scenario} ${JSON.stringify(
          result.errors
        )}`
      );
    }
  }
  console.log(`Results: ${runOutput}`);
  if (interrupted.signal.aborted || summary.results.some((r) => !r.ok))
    process.exitCode = 1;
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
