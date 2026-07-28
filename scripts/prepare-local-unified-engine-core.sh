#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODULE_DIR="$ROOT_DIR/modules/uc-engine"
CORE_DIR="${1:-$ROOT_DIR/../core}"

if [[ $# -gt 1 ]]; then
  echo "Usage: $0 [core-repository]" >&2
  exit 2
fi
if [[ ! -f "$CORE_DIR/Cargo.toml" ]]; then
  echo "Core repository not found at $CORE_DIR" >&2
  exit 1
fi
CORE_DIR="$(cd "$CORE_DIR" && pwd)"
BUILD_SCRIPT="$CORE_DIR/bindings/uc-engine-uniffi/scripts/build-ios-xcframework.sh"
if [[ ! -x "$BUILD_SCRIPT" ]]; then
  echo "Core iOS build script is missing or not executable: $BUILD_SCRIPT" >&2
  exit 1
fi

if [[ -z "${DEVELOPER_DIR:-}" && -d /Applications/Xcode.app/Contents/Developer ]]; then
  export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
fi

TARGET_DIR="${UC_ENGINE_LOCAL_TARGET_DIR:-$MODULE_DIR/.artifacts/local/build}"
export UC_ENGINE_UNIFFI_TARGET_DIR="$TARGET_DIR"
export UC_ENGINE_UNIFFI_BUILD_LOCKED=1
export UC_ENGINE_UNIFFI_IOS_DEPLOYMENT_TARGET=16.4

source_commit="$(git -C "$CORE_DIR" rev-parse HEAD)"
source_state_sha256="$({
  git -C "$CORE_DIR" diff --binary --no-ext-diff HEAD
  while IFS= read -r -d '' untracked_file; do
    printf 'untracked:%s\0' "$untracked_file"
    shasum -a 256 "$CORE_DIR/$untracked_file"
  done < <(git -C "$CORE_DIR" ls-files --others --exclude-standard -z)
} | shasum -a 256 | awk '{print $1}')"

"$BUILD_SCRIPT"

DIST_DIR="$TARGET_DIR/uc-engine-uniffi-dist/ios"
SWIFT_BINDING="$DIST_DIR/uc_engine_uniffi.swift"
XCFRAMEWORK="$DIST_DIR/UniClipboardEngine.xcframework"
if [[ ! -f "$SWIFT_BINDING" || ! -d "$XCFRAMEWORK" ]]; then
  echo "Core iOS build did not produce the expected binding and XCFramework" >&2
  exit 1
fi

mkdir -p "$MODULE_DIR/ios/Bindings"
cp "$SWIFT_BINDING" "$MODULE_DIR/ios/Bindings/uc_engine_uniffi.swift"
find "$MODULE_DIR/ios/UniClipboardEngine.xcframework" -depth -delete 2>/dev/null || true
ditto "$XCFRAMEWORK" "$MODULE_DIR/ios/UniClipboardEngine.xcframework"

node "$ROOT_DIR/scripts/verify-unified-engine-core.mjs" \
  --record-local \
  --source-commit "$source_commit" \
  --source-state-sha256 "$source_state_sha256"

echo "Prepared local iOS engine from $source_commit"
