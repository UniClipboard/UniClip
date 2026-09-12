import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { parseAllDocuments, parse } = require("yaml");
const root = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../.maestro"
);
function readFlow(path, stack = []) {
  assert.ok(!stack.includes(path), `Recursive flow: ${path}`);
  assert.ok(path.startsWith(root + "/"), "Flow escaped workspace");
  const docs = parseAllDocuments(readFileSync(path, "utf8"));
  for (const doc of docs) assert.deepEqual(doc.errors, []);
  assert.equal(docs.length, 2);
  const [header, body] = docs.map((d) => d.toJSON());
  assert.equal(header.appId, "${APP_ID}");
  assert.ok(Array.isArray(body));
  function checkSteps(steps) {
    for (const step of steps) {
      if (!step.runFlow) continue;
      const target =
        typeof step.runFlow === "string" ? step.runFlow : step.runFlow.file;
      if (target) readFlow(resolve(dirname(path), target), [...stack, path]);
      if (step.runFlow.commands) checkSteps(step.runFlow.commands);
    }
  }
  checkSteps(body);
  return body;
}
test("every discovered scenario has valid, acyclic Maestro subflows and explicit assertions", () => {
  assert.deepEqual(
    parse(readFileSync(resolve(root, "config.yaml"), "utf8")).flows,
    ["scenarios/*"]
  );
  const scenarios = readdirSync(resolve(root, "scenarios")).filter((f) =>
    f.endsWith(".yaml")
  );
  for (const required of [
    "first-launch.yaml",
    "settings-navigation.yaml",
    "history-text-lifecycle.yaml",
    "history-search-filter.yaml",
  ]) {
    assert.ok(scenarios.includes(required), `Missing scenario: ${required}`);
  }
  for (const name of scenarios) {
    const body = readFlow(resolve(root, "scenarios", name));
    assert.ok(
      body.some(
        (s) =>
          typeof s.runFlow === "string" && s.runFlow.includes("/assertions/")
      )
    );
    assert.ok(
      body.every((s) => !s.tapOn),
      "Scenario must reuse user actions"
    );
  }
});
test("storage regression taps inside the identified full row and records its layout", () => {
  const body = readFlow(
    resolve(root, "actions/settings/open-storage-from-trailing-space.yaml")
  );
  const tap = body.find((s) => s.tapOn)?.tapOn;
  assert.equal(tap.id, "settings-storage");
  assert.equal(tap.point, "85%,50%");
  assert.ok(body.find((s) => s.takeScreenshot));
});

test("clipboard fixtures use system Copy and lifecycle checks persist across restart", () => {
  const copy = readFlow(resolve(root, "actions/clipboard/copy-text.yaml"));
  assert.ok(JSON.stringify(copy).includes("doubleTapOn"));
  assert.ok(JSON.stringify(copy).includes("longPressOn"));
  assert.ok(copy.some((step) => step.tapOn === "(?i)copy"));
  assert.ok(copy.every((step) => !step.setClipboard && !step.runScript));
  const lifecycle = readFlow(
    resolve(root, "scenarios/history-text-lifecycle.yaml")
  );
  assert.equal(
    lifecycle.filter((s) => s.runFlow === "../lifecycle/restart.yaml").length,
    2
  );
});

test("a restart explicitly terminates once, while launching does not terminate an unused fresh app", () => {
  const launch = readFlow(resolve(root, "lifecycle/launch.yaml"));
  const restart = readFlow(resolve(root, "lifecycle/restart.yaml"));
  assert.equal(launch.find((s) => s.launchApp)?.launchApp.stopApp, false);
  assert.equal(restart.filter((s) => s === "stopApp").length, 1);
  assert.equal(restart.find((s) => s.launchApp)?.launchApp.stopApp, false);
});

test("diagnostics regression covers capture, restart and export through reusable actions", () => {
  const body = readFlow(resolve(root, "scenarios/diagnostic-capture.yaml"));
  const text = JSON.stringify(body);
  assert.ok(text.includes("diagnostics/start"));
  assert.ok(text.includes("diagnostics/stop"));
  assert.ok(text.includes("lifecycle/restart"));
  assert.ok(text.includes("diagnostics/export"));
  assert.ok(body.every((s) => !s.tapOn));
});

test("background setup returns to the app without backing out of it", () => {
  const body = readFlow(resolve(root, "actions/settings/enable-background.yaml"));
  assert.equal(body.filter((step) => step === "back").length, 1);
  assert.ok(body.some((step) => step.runFlow?.when?.visible === "Settings"));
  const lastLaunch = body.findLastIndex((step) => step.launchApp);
  const homeCheck = body.findLastIndex(
    (step) => step.runFlow === "../../assertions/home-ready.yaml"
  );
  assert.ok(lastLaunch > -1 && lastLaunch < homeCheck);
});

test("network acceptance phases reuse UI actions and keep network tests opt-in", () => {
  for (const name of readdirSync(resolve(root, "network-scenarios")).filter(name => name.endsWith(".yaml"))) {
    const body = readFlow(resolve(root, "network-scenarios", name));
    assert.ok(
      body.every((step) => !step.tapOn && !step.inputText && !step.runScript)
    );
  }
  const join = readFlow(resolve(root, "actions/space/submit-invitation.yaml"));
  assert.ok(join.some((step) => step.inputText === "${INVITATION_CODE}"));
  assert.ok(join.some((step) => step.inputText === "${SPACE_PASSWORD}"));
});
