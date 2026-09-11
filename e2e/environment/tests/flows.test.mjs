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
  for (const step of body) {
    if (step.runFlow) {
      const target =
        typeof step.runFlow === "string" ? step.runFlow : step.runFlow.file;
      if (target) readFlow(resolve(dirname(path), target), [...stack, path]);
    }
  }
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
  assert.equal(scenarios.length, 2);
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
