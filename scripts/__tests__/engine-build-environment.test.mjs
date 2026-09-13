import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

function profiles(override) {
  const env = {
    ...process.env,
    UC_ENGINE_LOCAL_TARGET_DIR: "/already-selected-output",
  };
  delete env.CARGO_PROFILE_RELEASE_DEBUG;
  if (override !== undefined) env.CARGO_PROFILE_RELEASE_DEBUG = override;
  return execFileSync(
    "bash",
    [
      "-euc",
      `
    source "$1"
    
    uc_engine_run_build bash -c 'export CARGO_PROFILE_RELEASE_DEBUG="\${CARGO_PROFILE_RELEASE_DEBUG:-0}"; printf "%s\\n" "$CARGO_PROFILE_RELEASE_DEBUG"'
    uc_engine_run_build bash -c 'printf "%s\\n" "\${CARGO_PROFILE_RELEASE_DEBUG:-different-cargo-default}"'
  `,
      "_",
      resolve("scripts/engine-build-storage.sh"),
    ],
    { env, encoding: "utf8" }
  )
    .trim()
    .split("\n");
}

test("Engine packaging retains ownership of release debug defaults", () => {
  assert.deepEqual(profiles(), ["0", "different-cargo-default"]);
});

test("an explicit debug setting applies to both platforms", () => {
  assert.deepEqual(profiles("1"), ["1", "1"]);
});

test("Engine build overrides do not leak into the app environment", () => {
  const output = execFileSync(
    "bash",
    [
      "-euc",
      `
    source "$1"
    unset CARGO_PROFILE_RELEASE_DEBUG DEVELOPER_DIR
    uc_engine_run_build bash -c 'export CARGO_PROFILE_RELEASE_DEBUG=1 DEVELOPER_DIR=/child-selected-xcode'
    test -z "\${CARGO_PROFILE_RELEASE_DEBUG:-}"
    test -z "\${DEVELOPER_DIR:-}"
  `,
      "_",
      resolve("scripts/engine-build-storage.sh"),
    ],
    { encoding: "utf8" }
  );
  assert.equal(output, "");
});

test("explicit Xcode selection is preserved for both Engine builds", () => {
  execFileSync("bash", [
    "-euc",
    `
    source "$1"
    export DEVELOPER_DIR=/caller-selected-xcode
    for platform in ios android; do
      uc_engine_run_build bash -c 'test "$DEVELOPER_DIR" = /caller-selected-xcode'
    done
  `,
    "_",
    resolve("scripts/engine-build-storage.sh"),
  ]);
});
