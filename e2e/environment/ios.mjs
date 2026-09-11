import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { command } from "./process.mjs";

export function iosDevice({ app, output }) {
  let id;
  const runtime = "com.apple.CoreSimulator.SimRuntime.iOS-26-3";
  const model = "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro";
  const sim = (...args) => command("xcrun", ["simctl", ...args]);
  return {
    get id() {
      return id;
    },
    metadata: { runtime, model, language: "en-US" },
    async prepare() {
      id = await sim("create", `uniclip-e2e-${randomUUID()}`, model, runtime);
      await writeFile(
        join(output, "owned-device.json"),
        JSON.stringify({ platform: "ios", id, runtime, model })
      );
      await sim("boot", id);
      await command("xcrun", ["simctl", "bootstatus", id, "-b"], {
        timeout: 240_000,
      });
      await sim(
        "spawn",
        id,
        "defaults",
        "write",
        "NSGlobalDomain",
        "AppleLanguages",
        "-array",
        "en"
      );
      await sim(
        "spawn",
        id,
        "defaults",
        "write",
        "NSGlobalDomain",
        "AppleLocale",
        "en_US"
      );
      await sim("ui", id, "appearance", "light");
      await sim("install", id, app);
    },
    async capture() {
      if (!id) return;
      await sim("io", id, "screenshot", join(output, "screen.png"));
      const log = await command(
        "xcrun",
        [
          "simctl",
          "spawn",
          id,
          "log",
          "show",
          "--last",
          "5m",
          "--style",
          "compact",
          "--predicate",
          'process CONTAINS "UniClip"',
        ],
        { timeout: 30_000 }
      );
      await writeFile(join(output, "app.log"), log);
    },
    async dispose() {
      if (!id) return;
      // Only the identifier returned by create is ever shut down or deleted.
      try {
        await sim("shutdown", id);
      } finally {
        await sim("delete", id);
      }
      id = undefined;
    },
  };
}
