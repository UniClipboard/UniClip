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

test("iOS installation refreshes native configuration before preparing and building the Engine", () => {
  const install = script.slice(
    script.indexOf("install_ios()"),
    script.indexOf("install_android()")
  );
  const prebuild = install.indexOf(
    "APP_VARIANT=development npx expo prebuild --platform ios --no-install"
  );
  assert.ok(prebuild > install.indexOf("assert_development_project ios"));
  assert.ok(prebuild < install.indexOf("prepare_install_engine ios"));
  const pods = install.indexOf("UC_ENGINE_LOCAL_CORE=1 npx pod-install ios");
  assert.ok(pods > install.indexOf("prepare_install_engine ios"));
  assert.ok(pods < install.indexOf("prepare-ios-debug-frameworks.mjs"));
  assert.ok(install.indexOf("prepare-ios-debug-frameworks.mjs") < install.indexOf("npx expo run:ios"));
});

test("physical iOS debug installs build Expo modules consistently from source", () => {
  const install = script.slice(script.indexOf("install_ios()"), script.indexOf("install_android()"));
  assert.match(install, /EXPO_USE_PRECOMPILED_MODULES=0 UC_ENGINE_LOCAL_CORE=1 npx pod-install ios/);
  assert.match(install, /EXPO_USE_PRECOMPILED_MODULES=0 UC_ENGINE_LOCAL_CORE=1 APP_VARIANT=development npx expo run:ios/);
});
