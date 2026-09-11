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
  assert.throws(() => parseOptions(["--platform", "android", "--app", "a", "--repeat", "8"]));
});
