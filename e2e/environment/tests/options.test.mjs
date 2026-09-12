import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOptions } from "../options.mjs";
test("requires an explicit platform and app, refuses unknown options and traversal", () => {
  for (const args of [
    [],
    ["--platform", "web", "--app", "a"],
    ["--platform", "ios"],
    ["--platform", "ios", "--app", "a", "--device", "booted"],
    ["--platform", "ios", "--app", "a", "--scenario", "../x"],
  ]) {
    assert.throws(() => parseOptions(args));
  }
  assert.deepEqual(
    parseOptions([
      "--platform",
      "ios",
      "--app",
      "a",
      "--scenario",
      "first-launch",
    ]),
    { platform: "ios", app: "a", scenario: "first-launch", repeat: 1 }
  );
});

test("rejects repetitions that exhaust the recommended emulator port range", () => {
  assert.throws(() =>
    parseOptions(["--platform", "android", "--app", "a", "--repeat", "8"])
  );
});

test("checks the whole selected suite against Android device capacity before execution", async () => {
  const { validateDeviceBudget } = await import("../options.mjs");
  assert.equal(typeof validateDeviceBudget, "function");
  assert.doesNotThrow(() => validateDeviceBudget("android", 4, 3));
  assert.throws(() => validateDeviceBudget("android", 4, 4));
  assert.doesNotThrow(() => validateDeviceBudget("ios", 4, 7));
});

test("network acceptance requires an explicit isolated desktop peer executable", () => {
  assert.throws(
    () =>
      parseOptions([
        "--platform",
        "ios",
        "--app",
        "/tmp/app.app",
        "--scenario",
        "bidirectional-sync",
      ]),
    /peer-cli/
  );
  assert.equal(
    parseOptions([
      "--platform",
      "ios",
      "--app",
      "/tmp/app.app",
      "--scenario",
      "bidirectional-sync",
      "--peer-cli",
      "/tmp/uniclip",
    ]).peerCli,
    "/tmp/uniclip"
  );
});

test('diagnostic fault scenarios also require an explicit isolated peer', () => {
  for (const scenario of ['diagnostic-auth-failure', 'diagnostic-connect-timeout', 'diagnostic-lifecycle', 'diagnostic-extensions']) {
    assert.throws(() => parseOptions(['--platform', 'ios', '--app', '/tmp/app.app', '--scenario', scenario]), /peer-cli/);
    assert.equal(parseOptions(['--platform', 'ios', '--app', '/tmp/app.app', '--scenario', scenario, '--peer-cli', '/tmp/uniclip']).scenario, scenario);
  }
});
