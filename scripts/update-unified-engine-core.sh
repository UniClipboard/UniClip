#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODULE_DIR="$ROOT_DIR/modules/uc-engine"
DIST_DIR="${1:-/tmp/uc-engine-uniffi-dist}"
PIN_FILE="$MODULE_DIR/core-source.json"

IOS_DIR="$DIST_DIR/ios"
ANDROID_DIR="$DIST_DIR/android"

for required in \
  "$IOS_DIR/UniClipboardEngine.xcframework.zip" \
  "$IOS_DIR/UniClipboardEngine.checksum.txt" \
  "$IOS_DIR/uc_engine_uniffi.swift" \
  "$IOS_DIR/core-version.txt" \
  "$IOS_DIR/source-commit.txt" \
  "$ANDROID_DIR/UniClipboardEngine.aar" \
  "$ANDROID_DIR/UniClipboardEngine.checksum.txt" \
  "$ANDROID_DIR/core-version.txt" \
  "$ANDROID_DIR/source-commit.txt"; do
  if [[ ! -f "$required" ]]; then
    echo "Missing unified engine artifact: $required" >&2
    exit 1
  fi
done

pin_version="$(node -p 'require(process.argv[1]).version' "$PIN_FILE")"
pin_commit="$(node -p 'require(process.argv[1]).sourceCommit' "$PIN_FILE")"
pin_ios_hash="$(node -p 'require(process.argv[1]).iosSha256' "$PIN_FILE")"
pin_android_hash="$(node -p 'require(process.argv[1]).androidSha256' "$PIN_FILE")"

ios_hash="$(shasum -a 256 "$IOS_DIR/UniClipboardEngine.xcframework.zip" | awk '{print $1}')"
android_hash="$(shasum -a 256 "$ANDROID_DIR/UniClipboardEngine.aar" | awk '{print $1}')"
ios_version="$(tr -d '\r\n' < "$IOS_DIR/core-version.txt")"
android_version="$(tr -d '\r\n' < "$ANDROID_DIR/core-version.txt")"
ios_commit="$(tr -d '\r\n' < "$IOS_DIR/source-commit.txt")"
android_commit="$(tr -d '\r\n' < "$ANDROID_DIR/source-commit.txt")"

if [[ "$ios_hash" != "$pin_ios_hash" || "$android_hash" != "$pin_android_hash" ]]; then
  echo "Unified engine artifact checksum does not match core-source.json" >&2
  exit 1
fi
if [[ "$ios_version" != "$pin_version" || "$android_version" != "$pin_version" ]]; then
  echo "Unified engine core version does not match core-source.json" >&2
  exit 1
fi
if [[ "$ios_commit" != "$pin_commit" || "$android_commit" != "$pin_commit" ]]; then
  echo "Unified engine source commit does not match core-source.json" >&2
  exit 1
fi

mkdir -p "$MODULE_DIR/ios/Bindings" "$MODULE_DIR/android/libs"
cp "$IOS_DIR/uc_engine_uniffi.swift" "$MODULE_DIR/ios/Bindings/uc_engine_uniffi.swift"
perl -pi -e 's/[ \t]+$//' "$MODULE_DIR/ios/Bindings/uc_engine_uniffi.swift"
rm -rf "$MODULE_DIR/ios/UniClipboardEngine.xcframework"
unzip -q "$IOS_DIR/UniClipboardEngine.xcframework.zip" -d "$MODULE_DIR/ios"
find "$MODULE_DIR/ios/UniClipboardEngine.xcframework" -name '._*' -delete
cp "$ANDROID_DIR/UniClipboardEngine.aar" "$MODULE_DIR/android/libs/UniClipboardEngine.aar"

echo "Prepared $pin_version from $pin_commit for iOS and Android"
