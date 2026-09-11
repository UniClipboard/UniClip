import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeSimulatorEntitlements } from "../entitlements.mjs";
test("decodes the simulator entitlement section, not signing metadata", () => {
  assert.equal(
    decodeSimulatorEntitlements(
      "Contents of (__TEXT,__entitlements) section\n0000000100000000 696c703c 003e7473\n"
    ),
    "<plist>"
  );
  assert.throws(() =>
    decodeSimulatorEntitlements("Contents of unrelated section")
  );
});
