import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const script = readFileSync(new URL('../install-dev-device.sh', import.meta.url), 'utf8');

test('isolates temporary Engine Cargo config while keeping a persistent cache', () => {
  assert.match(script, /cargo_home="\$LOCAL_ENGINE_BUILD_ROOT\/cargo-home"/);
  assert.match(script, /export CARGO_HOME/);
  assert.match(script, /rustc-wrapper\s*=\s*"sccache"/);
  assert.match(script, /prepare_local_engine_cargo_config/);
  assert.match(script, /uc-observability-contract = \{ path = "%s\/crates\/uc-observability-contract" \}/);
});

test('iOS cleanup preserves the original install exit status', () => {
  assert.match(script, /status=\$\?/);
  assert.match(script, /restore_pinned_ios_engine/);
  assert.match(script, /exit "\$status"/);
});
