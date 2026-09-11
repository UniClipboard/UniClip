import { test } from "node:test";
import assert from "node:assert/strict";
import { runScenario } from "../lifecycle.mjs";

function fixture(failAt) {
  const calls = [];
  const step = (name) => async () => {
    calls.push(name);
    if (failAt?.includes(name)) throw new Error(name + " failed");
  };
  return {
    calls,
    device: {
      prepare: step("prepare"),
      capture: step("capture"),
      dispose: step("dispose"),
    },
    execute: step("execute"),
  };
}
for (const failure of [
  [],
  ["execute"],
  ["prepare"],
  ["capture"],
  ["execute", "capture", "dispose"],
  ["dispose"],
]) {
  test(`lifecycle preserves outcome and releases resources: ${failure}`, async () => {
    const f = fixture(failure);
    const result = await runScenario(f.device, f.execute);
    assert.equal(result.ok, failure.length === 0);
    assert.equal(f.calls.at(-1), "dispose");
    assert.equal(f.calls.includes("execute"), !failure.includes("prepare"));
    assert.ok(f.calls.indexOf("capture") < f.calls.indexOf("dispose"));
    if (failure.length) assert.equal(result.errors[0].stage, failure[0]);
    assert.equal(result.errors.length, failure.length);
  });
}
