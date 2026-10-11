import { join } from "node:path";
import { homedir } from "node:os";
import { command } from "../environment/process.mjs";

/**
 * Read-only observation of the app under test on one owned emulator.
 * Records process identity, service state, task ownership and the native diagnostics
 * journal (closed vocabulary, no clipboard content). Nothing here changes device state.
 */
export function probe({ serial, appId, startedAt = Date.now() }) {
  const sdk = process.env.ANDROID_HOME ?? join(homedir(), "Library/Android/sdk");
  const adb = join(sdk, "platform-tools/adb");
  const run = (...args) => command(adb, ["-s", serial, ...args], { timeout: 180_000 });
  const shell = (cmd) => run("shell", cmd);
  const timeline = [];

  const parseServices = (text) => {
    const block = text.split(/\n\s*\*\s/).find((part) => part.includes("SyncForegroundService"));
    return {
      present: Boolean(block),
      foreground: block ? /isForeground=true/.test(block) : false,
      foregroundTypes: block?.match(/foregroundServiceType=(0x[0-9a-f]+)/)?.[1] ?? null,
    };
  };

  return {
    run,
    shell,
    timeline,
    event(type, detail = {}) {
      const entry = { t: Date.now() - startedAt, wall: new Date().toISOString(), type, ...detail };
      timeline.push(entry);
      return entry;
    },
    async sample(label) {
      const [pid, services, tasks] = await Promise.all([
        shell(`pidof ${appId}`).catch(() => ""),
        shell(`dumpsys activity services ${appId}`).catch(() => ""),
        shell(`dumpsys activity activities`).catch(() => ""),
      ]);
      const taskLines = tasks
        .split("\n")
        .filter((line) => line.includes(appId) && /(Task|ActivityRecord|topResumed)/.test(line))
        .map((line) => line.trim().slice(0, 200));
      const top = tasks.match(/topResumedActivity=.*?(\S+\/\S+)/)?.[1] ?? null;
      return this.event("sample", {
        label,
        pid: pid || null,
        service: parseServices(services),
        topResumed: top,
        appTaskLines: taskLines.slice(0, 12),
      });
    },
    /** Native journal events only; the journal never contains clipboard text. */
    async journal() {
      const raw = await shell(
        `run-as ${appId} sh -c 'cat cache/uc-engine/logs/* 2>/dev/null'`
      ).catch(() => "");
      return raw
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    },
    /** Engine operation outcomes from logcat (operation name, outcome, time); never message bodies. */
    async engineOperations(sinceEpochMs) {
      const raw = await run("logcat", "-d", "-v", "epoch", "-t", "20000", "UcEngine:I", "*:S").catch(() => "");
      return raw
        .split("\n")
        .map((line) => {
          const at = Number(line.match(/^\s*(\d+\.\d+)/)?.[1]) * 1000;
          const operation = line.match(/uc\.operation="([a-z_.]+)"/)?.[1];
          const outcome = line.match(/uc\.outcome="([a-z_]+)"/)?.[1];
          return operation && outcome && at >= sinceEpochMs ? { at: Math.round(at), operation, outcome } : null;
        })
        .filter(Boolean);
    },
    /** JS-side clipboard log lines (tags and hashes only) since a time; explains a missed capture. */
    async clipboardLogs(sinceEpochMs) {
      const raw = await run("logcat", "-d", "-v", "epoch", "-t", "20000", "ReactNativeJS:I", "UcClipboardObserve:I", "*:S").catch(() => "");
      return raw
        .split("\n")
        .map((line) => {
          const at = Number(line.match(/^\s*(\d+\.\d+)/)?.[1]) * 1000;
          const message = line.match(/(?:ReactNativeJS|UcClipboardObserve):\s*(.*)$/)?.[1] ?? "";
          return at >= sinceEpochMs && /Clipboard|Overlay|Polling|Monitor|observe|dispatch|appIsBackground/.test(message)
            ? { at: Math.round(at), message: message.slice(0, 160) }
            : null;
        })
        .filter(Boolean)
        .slice(0, 40);
    },
    /** The service's own file log (lifecycle callbacks only, never clipboard content). */
    async serviceLog() {
      return shell(`run-as ${appId} sh -c 'cat files/logs/kotlin_*.log 2>/dev/null'`)
        .then((text) => text.split("\n").filter((line) => line.includes("SyncForegroundService")).join("\n"))
        .catch(() => "");
    },
    async uiTexts() {
      await shell("uiautomator dump /sdcard/e2e-ui.xml");
      const xml = await shell("cat /sdcard/e2e-ui.xml");
      return [...xml.matchAll(/text="([^"]*)"/g)].map((m) => m[1]).filter(Boolean);
    },
  };
}
