import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { reserveEmulatorPort } from "./ports.mjs";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, writeFile, open } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { command } from "./process.mjs";

export function androidDevice({ app, output, network = "offline" }) {
  const sdk =
    process.env.ANDROID_HOME ?? join(homedir(), "Library/Android/sdk");
  const adb = join(sdk, "platform-tools/adb");
  const avdHome = join(output, "avd");
  const env = { ...process.env, ANDROID_HOME: sdk, ANDROID_AVD_HOME: avdHome };
  const name = `uniclip_e2e_${randomUUID().replaceAll("-", "")}`;
  const image = "system-images;android-36;google_apis;arm64-v8a";
  let id, child, logHandle;
  const device = (...args) => command(adb, ["-s", id, ...args]);
  return {
    get id() {
      return id;
    },
    metadata: {
      image,
      model: "pixel_8",
      language: "en-US",
      network,
    },
    async prepare() {
      await mkdir(avdHome, { recursive: true });
      await command(
        join(sdk, "cmdline-tools/latest/bin/avdmanager"),
        ["create", "avd", "-n", name, "-k", image, "-d", "pixel_8"],
        { env }
      );
      const port = await reserveEmulatorPort();
      id = `emulator-${port}`;
      await writeFile(
        join(output, "owned-device.json"),
        JSON.stringify({ platform: "android", id, name, avdHome, image })
      );
      logHandle = await open(join(output, "emulator.log"), "w");
      child = spawn(
        join(sdk, "emulator/emulator"),
        [
          "-avd",
          name,
          "-port",
          String(port),
          "-no-window",
          "-no-audio",
          "-no-boot-anim",
          "-no-snapshot",
          "-wipe-data",
          "-gpu",
          "swiftshader",
          "-prop",
          "persist.sys.locale=en-US",
        ],
        { env, stdio: ["ignore", logHandle.fd, logHandle.fd] }
      );
      let spawnError;
      child.on("error", (error) => {
        spawnError = error;
      });
      const deadline = Date.now() + 240_000;
      while (Date.now() < deadline) {
        if (spawnError) throw spawnError;
        if (child.exitCode !== null || child.signalCode !== null)
          throw new Error("Emulator exited before boot; see emulator.log");
        if (
          (await device("shell", "getprop", "sys.boot_completed").catch(
            () => ""
          )) === "1"
        )
          break;
        await delay(1000);
      }
      if ((await device("shell", "getprop", "sys.boot_completed")) !== "1")
        throw new Error("Emulator boot timed out");
      if (!(await device("emu", "avd", "name")).split(/\r?\n/).includes(name))
        throw new Error("Emulator ownership mismatch");
      await device("shell", "cmd", "uimode", "night", "no");
      await device(
        "shell",
        "settings",
        "put",
        "system",
        "screen_off_timeout",
        "2147483647"
      );
      await device("shell", "input", "keyevent", "224");
      await device("shell", "input", "keyevent", "82");
      await device("install", app);
      // Local-only scenarios must not depend on the current release server.
      await device(
        "shell",
        "svc",
        "wifi",
        network === "offline" ? "disable" : "enable"
      );
      await device(
        "shell",
        "cmd",
        "connectivity",
        "airplane-mode",
        network === "offline" ? "enable" : "disable"
      );
      // Radio changes can briefly reconnect adbd. Require consecutive successful
      // readiness observations before handing the device to Maestro (no flow retry).
      let stable = 0;
      const readyBy = Date.now() + 60_000;
      while (stable < 5 && Date.now() < readyBy) {
        const ready = await device(
          "shell",
          "getprop",
          "sys.boot_completed"
        ).catch(() => "");
        const airplane = await device(
          "shell",
          "settings",
          "get",
          "global",
          "airplane_mode_on"
        ).catch(() => "");
        const firstBoot = await device(
          "shell",
          "getprop",
          "sys.bootstat.first_boot_completed"
        ).catch(() => "");
        const provisioned = await device(
          "shell",
          "settings",
          "get",
          "global",
          "device_provisioned"
        ).catch(() => "");
        const userSetup = await device(
          "shell",
          "settings",
          "get",
          "secure",
          "user_setup_complete"
        ).catch(() => "");
        stable =
          ready === "1" &&
          airplane === (network === "offline" ? "1" : "0") &&
          firstBoot === "1" &&
          provisioned === "1" &&
          userSetup === "1"
            ? stable + 1
            : 0;
        if (stable < 5) await delay(1000);
      }
      if (stable < 5)
        throw new Error("Emulator did not settle after network setup");
    },
    async capture() {
      if (!child || child.exitCode !== null || child.signalCode !== null)
        return;
      if (!(await device("emu", "avd", "name")).split(/\r?\n/).includes(name))
        throw new Error("Refusing capture from unowned emulator");
      await device("shell", "screencap", "-p", "/sdcard/e2e-screen.png");
      await device(
        "pull",
        "/sdcard/e2e-screen.png",
        join(output, "screen.png")
      );
      await writeFile(
        join(output, "app.log"),
        await device("logcat", "-d", "-t", "3000")
      );
    },
    async dispose() {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        await Promise.race([
          new Promise((resolve) => child.once("exit", resolve)),
          delay(10_000, undefined, { ref: false }),
        ]);
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
          await new Promise((resolve) => child.once("exit", resolve));
        }
      }
      await logHandle?.close();
      // This AVD directory is freshly created within this run's output, never a user's AVD.
      const { rm } = await import("node:fs/promises");
      await rm(avdHome, { recursive: true, force: true });
    },
  };
}
