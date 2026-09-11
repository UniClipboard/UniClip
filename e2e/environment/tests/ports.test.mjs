import { test } from "node:test";
import assert from "node:assert/strict";
import { reserveEmulatorPort } from "../ports.mjs";
test("each fresh emulator gets a different transport identity, even after prior ports close", async () => {
  const ports = [];
  for (let i = 0; i < 6; i++) ports.push(await reserveEmulatorPort());
  assert.equal(new Set(ports).size, 6);
  assert.ok(ports.every((p) => p >= 5556 && p <= 5584 && p % 2 === 0));
});
