#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/engine-build-storage.sh"
MODULE_DIR="$ROOT_DIR/modules/uc-engine"
PIN_FILE="$MODULE_DIR/core-source.json"
pin_version="$(node -p 'require(process.argv[1]).version' "$PIN_FILE")"
pin_commit="$(node -p 'require(process.argv[1]).sourceCommit' "$PIN_FILE")"
repository="$(node -p 'require(process.argv[1]).repository' "$PIN_FILE")"
artifact_source="$(node -p 'require(process.argv[1]).artifactSource || "release"' "$PIN_FILE")"
# Commit pins build from source; --platform limits the build to what the calling runner can produce.
platform=all
if [[ "${1:-}" == "--platform" ]]; then
  platform="${2:?--platform requires ios, android or all}"
  case "$platform" in ios | android | all) ;; *) echo "--platform must be ios, android or all" >&2; exit 2 ;; esac
fi
if [[ "$artifact_source" == "local-build" || "$artifact_source" == "commit" ]]; then
  marker_dir="$pin_version"
  if [[ "$artifact_source" == "commit" ]]; then marker_dir="commit-$pin_commit"; fi
  if [[ -f "$MODULE_DIR/.artifacts/$marker_dir/prepared.json" ]] && \
      node "$ROOT_DIR/scripts/verify-unified-engine-core.mjs" --prepared --platform "$platform" >/dev/null 2>&1; then
    echo "Reusing verified local Engine $pin_version"
    exit 0
  fi
  uc_engine_build_storage_enter "$ROOT_DIR" "${BASH_SOURCE[0]}" "$@"
  engine_root="${UC_ENGINE_REPOSITORY:-$ROOT_DIR/../Engine}"
  if [[ "$artifact_source" == "commit" && ! -f "$engine_root/Cargo.toml" ]]; then
    # No sibling clone (CI): keep a minimal clone under .artifacts and fetch only the pinned commit.
    engine_root="$MODULE_DIR/.artifacts/engine-source"
    if [[ ! -d "$engine_root/.git" ]]; then
      mkdir -p "$engine_root"
      git -C "$engine_root" init --quiet
      git -C "$engine_root" remote add origin "https://github.com/$repository.git"
    fi
  elif [[ ! -f "$engine_root/Cargo.toml" ]]; then
    echo "Engine repository is not available: $engine_root" >&2
    exit 1
  fi
  if ! git -C "$engine_root" cat-file -e "$pin_commit^{commit}" 2>/dev/null; then
    git -C "$engine_root" fetch --depth 1 origin "$pin_commit"
  fi

  local_target="$(uc_engine_build_target "$engine_root")"

  # Cargo also discovers configuration in source ancestors, including the user's home.
  scratch="$(mktemp -d /tmp/mobile-engine-pin.XXXXXX)"
  worktree="$scratch/source"
  original_cargo_home="${CARGO_HOME:-$HOME/.cargo}"
  export CARGO_HOME="${UC_ENGINE_STORAGE_BUILD_DIR:-$local_target}/cargo-home"
  mkdir -p "$CARGO_HOME"
  for cache in registry git; do
    # 已有链接不能再作为 ln 的目标目录，否则会在共享缓存里创建自指链接。
    if [[ ! -e "$CARGO_HOME/$cache" && ! -L "$CARGO_HOME/$cache" && -d "$original_cargo_home/$cache" ]]; then
      ln -s "$original_cargo_home/$cache" "$CARGO_HOME/$cache"
    fi
  done
  trap 'git -C "$engine_root" worktree remove --force "$worktree"; rm -rf "$scratch"' EXIT
  git -C "$engine_root" worktree add --detach "$worktree" "$pin_commit"

  build_profile=dev
  if [[ "$artifact_source" == "commit" ]]; then
    # Commit pins can reach store builds, so they are always release builds.
    build_profile=release
    if command -v rustup >/dev/null 2>&1; then
      toolchain="$(cd "$worktree" && rustup show active-toolchain | awk '{print $1}')"
      if [[ "$platform" != android ]]; then
        rustup target add --toolchain "$toolchain" aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
      fi
      if [[ "$platform" != ios ]]; then
        rustup target add --toolchain "$toolchain" aarch64-linux-android x86_64-linux-android
      fi
    fi
    if [[ "$platform" != ios ]] && ! command -v cargo-ndk >/dev/null 2>&1; then
      cargo install cargo-ndk --version 4.1.2 --locked
    fi
  fi

  if [[ "$platform" != android ]]; then
    UC_ENGINE_PREPARE_ONLY=1 UC_ENGINE_LOCAL_TARGET_DIR="$local_target" \
      UC_ENGINE_UNIFFI_BUILD_PROFILE="$build_profile" \
      bash "$ROOT_DIR/scripts/prepare-local-unified-engine-core.sh" "$worktree"
  fi
  if [[ "$platform" != ios ]]; then
    (
      cd "$worktree"
      UC_ENGINE_UNIFFI_TARGET_DIR="$local_target" \
        UC_ENGINE_UNIFFI_BUILD_LOCKED=1 \
        uc_engine_run_build bindings/uc-engine-uniffi/scripts/build-android-aar.sh
    )
  fi

  publish_local_all() {
    local ROOT_DIR="$1" MODULE_DIR="$2" pin_version="$3" local_target="$4" pin_commit="$5"
    local platform="$6" artifact_source="$7" marker_dir="$8"
    test "$(node -p 'require(process.argv[1]).sourceCommit' "$MODULE_DIR/core-source.json")" = "$pin_commit"
    local dist_root="$local_target/uc-engine-uniffi-dist" cache_dir="$MODULE_DIR/.artifacts/$marker_dir"
    mkdir -p "$cache_dir"
    if [[ "$platform" != android ]]; then
      test -d "$dist_root/ios/UniClipboardEngine.xcframework"
      mkdir -p "$MODULE_DIR/ios/Bindings"
      cp "$dist_root/ios/uc_engine_uniffi.swift" "$MODULE_DIR/ios/Bindings/uc_engine_uniffi.swift"
      find "$MODULE_DIR/ios/UniClipboardEngine.xcframework" -depth -delete 2>/dev/null || true
      ditto "$dist_root/ios/UniClipboardEngine.xcframework" "$MODULE_DIR/ios/UniClipboardEngine.xcframework"
      cp "$dist_root/ios/UniClipboardEngine.xcframework.zip" "$cache_dir/"
      cp "$dist_root/ios/uc_engine_uniffi.swift" "$cache_dir/"
    fi
    if [[ "$platform" != ios ]]; then
      local plain_version="${pin_version#core-v}"
      plain_version="${plain_version#v}"
      local maven_dir="$MODULE_DIR/android/release-maven/app/uniclipboard/uniclipboard-engine/$plain_version"
      local metadata_dir="$MODULE_DIR/android/release-metadata"
      mkdir -p "$maven_dir" "$metadata_dir"
      cp "$dist_root/android/UniClipboardEngine.aar" "$maven_dir/uniclipboard-engine-$plain_version.aar"
      # The source crate keeps its release version; Maven must use the local pin coordinate.
      node - "$dist_root/android/UniClipboardEngine.pom" "$maven_dir/uniclipboard-engine-$plain_version.pom" "$plain_version" <<'NODE'
const fs = require('node:fs');
const [source, destination, version] = process.argv.slice(2);
const pom = fs.readFileSync(source, 'utf8');
if (!/<version>[^<]+<\/version>/.test(pom)) throw new Error('Engine POM version is missing');
fs.writeFileSync(destination, pom.replace(/<version>[^<]+<\/version>/, () => `<version>${version}</version>`));
NODE
      cp "$dist_root/android/runtime-dependencies.txt" "$metadata_dir/runtime-dependencies.txt"
      cp "$dist_root/android/uc_engine_uniffi.kt" "$metadata_dir/uc_engine_uniffi.kt"
    fi

    if [[ "$artifact_source" == "commit" ]]; then
      node "$ROOT_DIR/scripts/verify-unified-engine-core.mjs" --record-prepared --platform "$platform" --build-profile release
      node "$ROOT_DIR/scripts/verify-unified-engine-core.mjs" --prepared --platform "$platform"
    else
      node "$ROOT_DIR/scripts/verify-unified-engine-core.mjs" --record-prepared
      node "$ROOT_DIR/scripts/verify-unified-engine-core.mjs" --prepared
    fi
  }
  export -f publish_local_all
  uc_engine_publish "$ROOT_DIR" bash -euo pipefail -c 'publish_local_all "$@"' _ "$ROOT_DIR" "$MODULE_DIR" "$pin_version" "$local_target" "$pin_commit" "$platform" "$artifact_source" "$marker_dir"
  exit 0
fi
version_asset="$(node -e '
  const pin = require(process.argv[1]);
  const name = ["version.txt", "core-version.txt"].find((candidate) => pin.artifacts[candidate]);
  if (!name) process.exit(1);
  process.stdout.write(name);
' "$PIN_FILE")"
CACHE_DIR="$MODULE_DIR/.artifacts/$pin_version"
BASE_URL="https://github.com/$repository/releases/download/$pin_version"

assets=(
  release-manifest.json
  UniClipboardEngine.aar
  UniClipboardEngine.aar.checksum.txt
  UniClipboardEngine.pom
  UniClipboardEngine.xcframework.checksum.txt
  UniClipboardEngine.xcframework.zip
  "$version_asset"
  runtime-dependencies.txt
  source-commit.txt
  uc_engine_uniffi.kt
  uc_engine_uniffi.swift
)

mkdir -p "$CACHE_DIR"
for asset in "${assets[@]}"; do
  destination="$CACHE_DIR/$asset"
  expected="$(node -e '
    const pin = require(process.argv[1]);
    const name = process.argv[2];
    process.stdout.write(name === "release-manifest.json" ? pin.releaseManifestSha256 : pin.artifacts[name]);
  ' "$PIN_FILE" "$asset")"
  if [[ -f "$destination" ]] && [[ "$(shasum -a 256 "$destination" | awk '{print $1}')" == "$expected" ]]; then
    continue
  fi
  download="$(mktemp "$destination.download.XXXXXX")"
  if ! curl --fail --location --retry 3 --output "$download" "$BASE_URL/$asset"; then
    rm -f "$download"
    exit 1
  fi
  mv "$download" "$destination"
done

node "$ROOT_DIR/scripts/verify-unified-engine-core.mjs" --downloads "$CACHE_DIR"

publish_release() {
  local ROOT_DIR="$1" MODULE_DIR="$2" pin_version="$3" CACHE_DIR="$4" pin_commit="$5"
  test "$(node -p 'require(process.argv[1]).sourceCommit' "$MODULE_DIR/core-source.json")" = "$pin_commit"
plain_version="${pin_version#core-v}"
plain_version="${plain_version#v}"
maven_dir="$MODULE_DIR/android/release-maven/app/uniclipboard/uniclipboard-engine/$plain_version"
metadata_dir="$MODULE_DIR/android/release-metadata"
mkdir -p "$maven_dir" "$metadata_dir" "$MODULE_DIR/ios/Bindings"
cp "$CACHE_DIR/UniClipboardEngine.aar" "$maven_dir/uniclipboard-engine-$plain_version.aar"
cp "$CACHE_DIR/UniClipboardEngine.pom" "$maven_dir/uniclipboard-engine-$plain_version.pom"
cp "$CACHE_DIR/runtime-dependencies.txt" "$metadata_dir/runtime-dependencies.txt"
cp "$CACHE_DIR/uc_engine_uniffi.kt" "$metadata_dir/uc_engine_uniffi.kt"
cp "$CACHE_DIR/uc_engine_uniffi.swift" "$MODULE_DIR/ios/Bindings/uc_engine_uniffi.swift"

find "$MODULE_DIR/ios/UniClipboardEngine.xcframework" -depth -delete 2>/dev/null || true
unzip -q "$CACHE_DIR/UniClipboardEngine.xcframework.zip" -d "$MODULE_DIR/ios"
find "$MODULE_DIR/ios/UniClipboardEngine.xcframework" -name '._*' -delete

node "$ROOT_DIR/scripts/verify-unified-engine-core.mjs" --record-prepared
node "$ROOT_DIR/scripts/verify-unified-engine-core.mjs" --prepared

echo "Prepared $pin_version from $pin_commit for Android and iOS"

}
export -f publish_release
uc_engine_publish "$ROOT_DIR" bash -euo pipefail -c 'publish_release "$@"' _ "$ROOT_DIR" "$MODULE_DIR" "$pin_version" "$CACHE_DIR" "$pin_commit"
