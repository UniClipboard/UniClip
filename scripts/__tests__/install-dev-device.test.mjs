import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const script = readFileSync(
  new URL("../install-dev-device.sh", import.meta.url),
  "utf8"
);

test("isolates temporary Engine Cargo config while keeping a persistent cache", () => {
  assert.ok(
    script.includes(
      'cargo_home="${UC_ENGINE_STORAGE_BUILD_DIR:-$LOCAL_ENGINE_BUILD_ROOT}/cargo-home"'
    )
  );
  assert.match(script, /export CARGO_HOME/);
  assert.match(script, /rustc-wrapper\s*=\s*"sccache"/);
  assert.match(script, /prepare_local_engine_cargo_config/);
  assert.match(
    script,
    /uc-observability-contract = \{ path = "%s\/crates\/uc-observability-contract" \}/
  );
});

test("iOS cleanup preserves the original install exit status", () => {
  assert.match(script, /status=\$\?/);
  assert.match(script, /restore_pinned_ios_engine/);
  assert.match(script, /exit "\$status"/);
});

test("iOS installation prepares native configuration before building the Engine", () => {
  const install = script.slice(
    script.indexOf("install_ios()"),
    script.indexOf("install_android()")
  );
  const preparation = install.indexOf('prepare-ios-development-project.sh');
  assert.ok(preparation < install.indexOf("assert_development_project ios"));
  assert.ok(preparation < install.indexOf("prepare_install_engine ios"));
});

test("physical iOS installation builds only the device Engine and reuses unchanged bindings", () => {
  const install = script.slice(
    script.indexOf("install_ios()"),
    script.indexOf("install_android()")
  );
  assert.match(install, /UC_ENGINE_UNIFFI_SLICE=device/);
  assert.match(script, /UC_ENGINE_UNIFFI_BINDINGS_CACHE_DIR/);
});

test("physical iOS debug installs build Expo modules consistently from source", () => {
  const install = script.slice(script.indexOf("install_ios()"), script.indexOf("install_android()"));
  assert.match(install, /EXPO_USE_PRECOMPILED_MODULES=0/);
  assert.match(install, /APP_VARIANT=development/);
  assert.match(install, /npx expo run:ios/);
});

test("the managed iOS install keeps React Native code generation enabled", () => {
  const install = script.slice(script.indexOf("install_ios()"), script.indexOf("install_android()"));
  assert.equal((install.match(/RCT_IGNORE_PODS_DEPRECATION=0 RCT_SKIP_CODEGEN=0/g) ?? []).length, 1);
  const build = install.slice(install.indexOf('RCT_IGNORE_PODS_DEPRECATION=0'));
  assert.doesNotMatch(build, /2>\/dev\/null|--silent|--quiet/);
});
