import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { access, open, mkdir, writeFile, rm, cp } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
import { command } from "../environment/process.mjs";

/** Owns a fresh headless profile; never observes or changes the Mac clipboard. */
export function desktopPeer(cli, output) {
  const profile = `mobile-e2e-${randomUUID()}`;
  const data = join(
    homedir(),
    "Library/Application Support",
    `app.uniclipboard.desktop-${profile}`
  );
  const logs = join(
    homedir(),
    "Library/Logs",
    `app.uniclipboard.desktop-${profile}`
  );
  const env = {
    ...process.env,
    UC_PROFILE: profile,
    UNICLIPBOARD_ENV: "development",
    UC_DAEMON_RUN_MODE: "server",
  };
  const base = ["--dev", "--profile", profile];
  const passphrase = `E2e-${randomUUID()}`;
  let daemon, invitation, outputHandle, processFailure;
  let owned = false;
  const call = (args) =>
    command(cli, [...base, ...args], { env, timeout: 60_000 });
  return {
    passphrase,
    async prepare() {
      await assert.rejects(access(data), { code: "ENOENT" });
      await mkdir(data);
      owned = true;
      await writeFile(
        join(output, "owned-peer.json"),
        JSON.stringify(
          {
            profile,
            cli,
            data,
            logs,
            clipboard: "headless-no-system-clipboard",
          },
          null,
          2
        )
      );
      outputHandle = await open(join(output, "peer-process.log"), "w", 0o600);
      daemon = spawn(join(dirname(cli), "uniclipd"), [], {
        env,
        stdio: ["ignore", outputHandle.fd, outputHandle.fd],
      });
      daemon.once("error", (error) => {
        processFailure = error;
      });
      // Wait for the daemon's connection descriptor before issuing setup through the real CLI.
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        if (processFailure) throw processFailure;
        if (daemon.exitCode !== null)
          throw new Error("Isolated peer exited during startup");
        if (
          await access(join(data, "daemon.conn")).then(
            () => true,
            () => false
          )
        )
          break;
        await delay(250);
      }
      await access(join(data, "daemon.conn"));
      const initialized = await call([
        "space",
        "init",
        "--passphrase",
        passphrase,
        "--device-name",
        "Simulator acceptance peer",
      ]);
      await writeFile(join(output, "peer-initialized.txt"), initialized);
      let invitationText = "";
      invitation = spawn(cli, [...base, "space", "invite"], {
        env,
        stdio: ["ignore", "pipe", outputHandle.fd],
      });
      invitation.once("error", (error) => {
        processFailure = error;
      });
      invitation.stdout.setEncoding("utf8");
      invitation.stdout.on("data", (data) => {
        invitationText += data;
      });
      const expires = Date.now() + 45_000;
      while (Date.now() < expires) {
        if (processFailure) throw processFailure;
        const match = invitationText.match(/INVITATION_CODE=([0-9-]+)/);
        if (match) return match[1].replaceAll("-", "");
        if (invitation.exitCode !== null)
          throw new Error("Peer invitation failed before publishing a code");
        await delay(250);
      }
      throw new Error("Peer invitation did not become ready");
    },
    pause() {
      if (!daemon || daemon.exitCode !== null) throw new Error("Owned peer is not running");
      daemon.kill("SIGSTOP");
    },
    resume() { if (daemon && daemon.exitCode === null) daemon.kill("SIGCONT"); },
    async waitOnline(phase) {
      const deadline = Date.now() + 60_000;
      const observations = [];
      try {
        while (Date.now() < deadline) {
          // Read last-known status only: do not trigger a manual presence probe.
          const members = JSON.parse(await call(["--json", "members"]));
          observations.push({ at: new Date().toISOString(), members });
          if (
            members.some(
              (member) => !member.is_local && member.state === "online"
            )
          )
            return;
          await delay(1_000);
        }
        throw new Error(
          "Mobile did not automatically return online within 60 seconds"
        );
      } finally {
        await writeFile(
          join(output, `peer-readiness-${phase}.json`),
          JSON.stringify(observations, null, 2)
        );
      }
    },
    async send(text, phase, { allowDeferred = false } = {}) {
      let response;
      try {
        response = await call(["--json", "send", text]);
      } catch (error) {
        await writeFile(
          join(output, `peer-send-${phase}-failed.txt`),
          `${error.stdout ?? ""}\n${error.stderr ?? ""}`
        );
        if (!allowDeferred || !error.stdout?.trim()) throw error;
        response = error.stdout;
      }
      const result = JSON.parse(response);
      await writeFile(
        join(output, `peer-send-${phase}.json`),
        JSON.stringify(result, null, 2)
      );
      assert.ok(
        result.totalAccepted > 0 ||
          result.totalDuplicate > 0 ||
          (allowDeferred &&
            result.totalOffline > 0 &&
            result.totalErrored === 0),
        "Mobile neither acknowledged receipt nor deferred it while offline"
      );
    },
    async expectReceived(text, phase) {
      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline) {
        const received = await call(["get", "--type", "text"]).catch(
          () => null
        );
        if (received?.trim() === text) {
          await writeFile(join(output, `peer-received-${phase}.txt`), received);
          return;
        }
        await delay(1_000);
      }
      throw new Error("Desktop peer did not receive the mobile fixture");
    },
    async dispose() {
      if (daemon && daemon.exitCode === null) daemon.kill("SIGCONT");
      if (invitation && invitation.exitCode === null) invitation.kill("SIGINT");
      if (daemon && daemon.exitCode === null) {
        await call(["stop"]).catch(() => {});
        if (daemon.exitCode === null) {
          daemon.kill("SIGTERM");
          await Promise.race([
            new Promise((resolve) => daemon.once("exit", resolve)),
            delay(5_000),
          ]);
          if (daemon.exitCode === null && daemon.signalCode === null) {
            daemon.kill("SIGKILL");
            await new Promise((resolve) => daemon.once("exit", resolve));
          }
        }
      }
      await outputHandle?.close();
      try {
        if (
          owned &&
          (await access(logs).then(
            () => true,
            () => false
          ))
        ) {
          await cp(logs, join(output, "peer-logs"), { recursive: true });
        }
      } finally {
        // These paths belong solely to this freshly generated UUID profile.
        if (owned) {
          await rm(data, { recursive: true, force: true });
          await rm(logs, { recursive: true, force: true });
        }
      }
    },
  };
}
