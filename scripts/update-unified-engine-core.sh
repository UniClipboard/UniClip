#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODULE_DIR="$ROOT_DIR/modules/uc-engine"
PIN_FILE="$MODULE_DIR/core-source.json"
pin_version="$(node -p 'require(process.argv[1]).version' "$PIN_FILE")"
pin_commit="$(node -p 'require(process.argv[1]).sourceCommit' "$PIN_FILE")"
repository="$(node -p 'require(process.argv[1]).repository' "$PIN_FILE")"
CACHE_DIR="$MODULE_DIR/.artifacts/$pin_version"
BASE_URL="https://github.com/$repository/releases/download/$pin_version"

assets=(
  release-manifest.json
  UniClipboardEngine.aar
  UniClipboardEngine.aar.checksum.txt
  UniClipboardEngine.pom
  UniClipboardEngine.xcframework.checksum.txt
  UniClipboardEngine.xcframework.zip
  core-version.txt
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
