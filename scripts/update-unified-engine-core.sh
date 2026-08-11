#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODULE_DIR="$ROOT_DIR/modules/uc-engine"
PIN_FILE="$MODULE_DIR/core-source.json"
pin_version="$(node -p 'require(process.argv[1]).version' "$PIN_FILE")"
pin_commit="$(node -p 'require(process.argv[1]).sourceCommit' "$PIN_FILE")"
repository="$(node -p 'require(process.argv[1]).repository' "$PIN_FILE")"
artifact_source="$(node -p 'require(process.argv[1]).artifactSource || "release"' "$PIN_FILE")"
if [[ "$artifact_source" == "local-build" ]]; then
  engine_root="${UC_ENGINE_REPOSITORY:-$ROOT_DIR/../Engine}"
  if [[ ! -f "$engine_root/Cargo.toml" ]]; then
    echo "Engine repository is not available: $engine_root" >&2
    exit 1
  fi
  if ! git -C "$engine_root" cat-file -e "$pin_commit^{commit}"; then
    git -C "$engine_root" fetch origin "$pin_commit"
  fi

  worktree="$(mktemp -d "$MODULE_DIR/.artifacts/local/engine-pin.XXXXXX")"
  rmdir "$worktree"
  git -C "$engine_root" worktree add --detach "$worktree" "$pin_commit"
  trap 'git -C "$engine_root" worktree remove --force "$worktree"' EXIT

  local_target="${UC_ENGINE_LOCAL_TARGET_DIR:-$MODULE_DIR/.artifacts/pinned/$pin_commit}"
  UC_ENGINE_LOCAL_TARGET_DIR="$local_target" \
    bash "$ROOT_DIR/scripts/prepare-local-unified-engine-core.sh" "$worktree"
  (
    cd "$worktree"
    UC_ENGINE_UNIFFI_TARGET_DIR="$local_target" \
      UC_ENGINE_UNIFFI_BUILD_LOCKED=1 \
      bindings/uc-engine-uniffi/scripts/build-android-aar.sh
  )

  plain_version="${pin_version#core-v}"
  plain_version="${plain_version#v}"
  maven_dir="$MODULE_DIR/android/release-maven/app/uniclipboard/uniclipboard-engine/$plain_version"
  metadata_dir="$MODULE_DIR/android/release-metadata"
  dist_root="$local_target/uc-engine-uniffi-dist"
  mkdir -p "$maven_dir" "$metadata_dir"
  cp "$dist_root/android/UniClipboardEngine.aar" "$maven_dir/uniclipboard-engine-$plain_version.aar"
  cp "$dist_root/android/UniClipboardEngine.pom" "$maven_dir/uniclipboard-engine-$plain_version.pom"
  cp "$dist_root/android/runtime-dependencies.txt" "$metadata_dir/runtime-dependencies.txt"
  cp "$dist_root/android/uc_engine_uniffi.kt" "$metadata_dir/uc_engine_uniffi.kt"

  node "$ROOT_DIR/scripts/verify-unified-engine-core.mjs" --record-prepared
  node "$ROOT_DIR/scripts/verify-unified-engine-core.mjs" --prepared
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
  curl --fail --location --retry 3 --output "$destination.download" "$BASE_URL/$asset"
  mv "$destination.download" "$destination"
done

node "$ROOT_DIR/scripts/verify-unified-engine-core.mjs" --downloads "$CACHE_DIR"

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
