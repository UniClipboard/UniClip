import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

for (const useOverride of [true, false]) {
  test(`local preparation shares build storage with isolated Cargo configuration (override=${useOverride})`, () => {
    const root = mkdtempSync(join(tmpdir(), "mobile-core-test-"));
    try {
      const mobile = join(root, "mobile");
      const engine = join(root, "Engine");
      const module = join(mobile, "modules/uc-engine");
      mkdirSync(join(module, ".artifacts/local"), { recursive: true });
      mkdirSync(join(mobile, "scripts"), { recursive: true });
      mkdirSync(join(engine, "bindings/uc-engine-uniffi/scripts"), {
        recursive: true,
      });
      writeFileSync(join(engine, "Cargo.toml"), "");
      writeFileSync(
        join(engine, "bindings/uc-engine-uniffi/scripts/build-android-aar.sh"),
        `#!/bin/bash
set -eu
test ! -f "$CARGO_HOME/config.toml"
mkdir -p "$UC_ENGINE_UNIFFI_TARGET_DIR/uc-engine-uniffi-dist/android"
for name in UniClipboardEngine.aar UniClipboardEngine.pom runtime-dependencies.txt uc_engine_uniffi.kt; do
  touch "$UC_ENGINE_UNIFFI_TARGET_DIR/uc-engine-uniffi-dist/android/$name"
done
printf '<project><version>1.1.0-rc.13</version><dependencies><dependency><version>5.0</version></dependency></dependencies></project>' > "$UC_ENGINE_UNIFFI_TARGET_DIR/uc-engine-uniffi-dist/android/UniClipboardEngine.pom"
`,
        { mode: 0o755 }
      );
      execFileSync("git", ["init", "-q", engine]);
      execFileSync("git", ["-C", engine, "add", "."]);
      execFileSync("git", [
        "-C",
        engine,
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "-qm",
        "fixture",
      ]);
      const commit = execFileSync("git", ["-C", engine, "rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim();
      writeFileSync(
        join(module, "core-source.json"),
        JSON.stringify({
          version: "v1.1.0-rc.13.local.abcdef12",
          sourceCommit: commit,
          artifactSource: "local-build",
        })
      );
      cpSync(
        resolve("scripts/engine-build-storage.sh"),
        join(mobile, "scripts/engine-build-storage.sh")
      );
      cpSync(
        resolve("scripts/update-unified-engine-core.sh"),
        join(mobile, "scripts/update-unified-engine-core.sh")
      );
      writeFileSync(
        join(mobile, "scripts/prepare-local-unified-engine-core.sh"),
        `#!/bin/bash
set -eu
printf '%s\\n%s\\n' "$1" "$CARGO_HOME" > "$TEST_CAPTURE"
test ! -f "$CARGO_HOME/config.toml"
mkdir -p "$UC_ENGINE_LOCAL_TARGET_DIR/uc-engine-uniffi-dist/ios/UniClipboardEngine.xcframework"
printf 'framework' > "$UC_ENGINE_LOCAL_TARGET_DIR/uc-engine-uniffi-dist/ios/UniClipboardEngine.xcframework.zip"
printf 'swift' > "$UC_ENGINE_LOCAL_TARGET_DIR/uc-engine-uniffi-dist/ios/uc_engine_uniffi.swift"
`
      );
      writeFileSync(join(mobile, "scripts/verify-unified-engine-core.mjs"), "");
      const cargo = join(root, "user-cargo");
      mkdirSync(cargo);
      mkdirSync(join(cargo, "registry"));
      mkdirSync(join(cargo, "git"));
      writeFileSync(join(cargo, "config.toml"), "[build]\n");
      const capture = join(root, "capture");
      const sharedBuild = join(root, "build");
      const tools = join(root, "tools");
      mkdirSync(tools);
      writeFileSync(join(tools, "ditto"), '#!/bin/bash\ncp -R "$1" "$2"\n', {
        mode: 0o755,
      });
      writeFileSync(
        join(tools, "cargo"),
        `#!/bin/bash
printf '%s\\n' '${JSON.stringify({ target_directory: sharedBuild })}'
`,
        { mode: 0o755 }
      );
      const runPrepare = () =>
        execFileSync(
          "bash",
          [join(mobile, "scripts/update-unified-engine-core.sh")],
          {
            env: {
              ...process.env,
              UC_ENGINE_REPOSITORY: engine,
              UC_ENGINE_LOCAL_TARGET_DIR: useOverride ? sharedBuild : "",
              PATH: `${tools}:${dirname(
                process.execPath
              )}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
              CARGO_HOME: cargo,
              TEST_CAPTURE: capture,
            },
            stdio: "pipe",
          }
        );
      runPrepare();
      runPrepare();
      assert.deepEqual(readdirSync(join(cargo, "registry")), []);
      assert.deepEqual(readdirSync(join(cargo, "git")), []);
      assert.equal(
        readFileSync(
          join(
            module,
            "android/release-maven/app/uniclipboard/uniclipboard-engine/1.1.0-rc.13.local.abcdef12/uniclipboard-engine-1.1.0-rc.13.local.abcdef12.pom"
          ),
          "utf8"
        ),
        "<project><version>1.1.0-rc.13.local.abcdef12</version><dependencies><dependency><version>5.0</version></dependency></dependencies></project>"
      );
      const [source, cargoHome] = readFileSync(capture, "utf8")
        .trim()
        .split("\n");
      assert.ok(!source.startsWith(realpathSync(mobile) + "/"));
      assert.notEqual(cargoHome, cargo);
      assert.equal(
        readFileSync(
          join(
            module,
            ".artifacts/v1.1.0-rc.13.local.abcdef12/UniClipboardEngine.xcframework.zip"
          ),
          "utf8"
        ),
        "framework"
      );
      assert.equal(
        readFileSync(
          join(
            module,
            ".artifacts/v1.1.0-rc.13.local.abcdef12/uc_engine_uniffi.swift"
          ),
          "utf8"
        ),
        "swift"
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

// 默认路径必须跨 Engine 提交复用，不能在应用中留下每提交一套编译树。
test("local build default uses the Engine output instead of a per-commit app directory", () => {
  const script = readFileSync(
    resolve("scripts/update-unified-engine-core.sh"),
    "utf8"
  );
  assert.ok(!script.includes(".artifacts/pinned/$pin_commit"));
  const prepare = readFileSync(
    resolve("scripts/prepare-local-unified-engine-core.sh"),
    "utf8"
  );
  assert.ok(!prepare.includes(".artifacts/local/build"));
});

test("the ordinary local iOS command uses the sibling Engine and copies its completed output", () => {
  const root = mkdtempSync(join(tmpdir(), "mobile-default-engine-"));
  try {
    const mobile = join(root, "mobile");
    const engine = join(root, "Engine");
    const tools = join(root, "tools");
    const target = join(root, "shared-output");
    mkdirSync(join(mobile, "scripts"), { recursive: true });
    mkdirSync(join(engine, "bindings/uc-engine-uniffi/scripts"), {
      recursive: true,
    });
    mkdirSync(tools);
    writeFileSync(join(engine, "Cargo.toml"), "[workspace]\nmembers=[]\n");
    writeFileSync(join(tools, "ditto"), '#!/bin/bash\ncp -R "$1" "$2"\n', {
      mode: 0o755,
    });
    writeFileSync(
      join(tools, "cargo"),
      `#!/bin/bash\nprintf '%s\\n' '${JSON.stringify({
        target_directory: target,
      })}'\n`,
      { mode: 0o755 }
    );
    writeFileSync(
      join(
        engine,
        "bindings/uc-engine-uniffi/scripts/build-ios-xcframework.sh"
      ),
      `#!/bin/bash
set -eu
result="$UC_ENGINE_UNIFFI_TARGET_DIR/uc-engine-uniffi-dist/ios"
mkdir -p "$result/UniClipboardEngine.xcframework"
printf 'framework' > "$result/UniClipboardEngine.xcframework/content"
printf 'binding' > "$result/uc_engine_uniffi.swift"
`,
      { mode: 0o755 }
    );
    for (const name of [
      "engine-build-storage.sh",
      "prepare-local-unified-engine-core.sh",
    ]) {
      cpSync(resolve("scripts", name), join(mobile, "scripts", name));
    }
    writeFileSync(join(mobile, "scripts/verify-unified-engine-core.mjs"), "");
    execFileSync("git", ["init", "-q", engine]);
    execFileSync("git", ["-C", engine, "add", "."]);
    execFileSync("git", [
      "-C",
      engine,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-qm",
      "fixture",
    ]);
    execFileSync(
      "bash",
      [join(mobile, "scripts/prepare-local-unified-engine-core.sh")],
      {
        env: {
          ...process.env,
          UC_ENGINE_LOCAL_TARGET_DIR: "",
          PATH: `${tools}:${dirname(
            process.execPath
          )}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
        },
        stdio: "pipe",
      }
    );
    assert.equal(
      readFileSync(
        join(
          mobile,
          "modules/uc-engine/ios/UniClipboardEngine.xcframework/content"
        ),
        "utf8"
      ),
      "framework"
    );
    assert.equal(
      readFileSync(
        join(mobile, "modules/uc-engine/ios/Bindings/uc_engine_uniffi.swift"),
        "utf8"
      ),
      "binding"
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a verified prepared local version does not start another Engine build", () => {
  const root = mkdtempSync(join(tmpdir(), "mobile-prepared-reuse-"));
  try {
    mkdirSync(join(root, "scripts"), { recursive: true });
    mkdirSync(join(root, "modules/uc-engine/.artifacts/v-test"), {
      recursive: true,
    });
    for (const file of [
      "update-unified-engine-core.sh",
      "engine-build-storage.sh",
    ]) {
      cpSync(resolve("scripts", file), join(root, "scripts", file));
    }
    writeFileSync(
      join(root, "modules/uc-engine/core-source.json"),
      JSON.stringify({
        version: "v-test",
        sourceCommit: "a".repeat(40),
        artifactSource: "local-build",
      })
    );
    writeFileSync(
      join(root, "modules/uc-engine/.artifacts/v-test/prepared.json"),
      "{}"
    );
    // 模拟原有校验器已确认文件完整；未提供 Engine 源码，重编会失败。
    writeFileSync(join(root, "scripts/verify-unified-engine-core.mjs"), "");
    execFileSync(
      "bash",
      [join(root, "scripts/update-unified-engine-core.sh")],
      {
        env: {
          ...process.env,
          UC_ENGINE_LOCAL_TARGET_DIR: "",
          UC_ENGINE_REPOSITORY: join(root, "missing-engine"),
          PATH: `${dirname(
            process.execPath
          )}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
        },
        stdio: "pipe",
      }
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
