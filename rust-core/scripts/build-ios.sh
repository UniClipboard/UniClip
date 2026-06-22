#!/usr/bin/env bash
# Build iOS xcframework + UniFFI Swift bindings from the upstream uniclipboard
# monorepo, then stage artifacts into modules/uc-core/ios/.
#
# Environment:
#   UC_RUST_REPO  — path to the uniclipboard monorepo (default: ~/MyProjects/uniclipboard)
#
# Prerequisites:
#   - Xcode with iOS SDK
#   - Rust targets: rustup target add \
#       aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUST_REPO="${UC_RUST_REPO:-$HOME/MyProjects/uniclipboard}"
MODULE_DIR="$REPO_ROOT/modules/uc-core/ios"

if [ ! -d "$RUST_REPO/crates/uc-mobile" ]; then
  echo "ERROR: UC_RUST_REPO not found at $RUST_REPO" >&2
  echo "Set UC_RUST_REPO to your uniclipboard monorepo path." >&2
  exit 1
fi

echo "==> Building from: $RUST_REPO"
(cd "$RUST_REPO" && crates/uc-mobile/scripts/build-ios-xcframework.sh)

echo "==> Staging xcframework into Expo module"
rm -rf "$MODULE_DIR/UniClipboardCore.xcframework"
cp -R "$RUST_REPO/target/UniClipboardCore.xcframework" "$MODULE_DIR/"

echo "==> Staging Swift bindings"
mkdir -p "$MODULE_DIR/Bindings"
cp "$RUST_REPO/target/uniffi-bindings/uc_mobile.swift" "$MODULE_DIR/Bindings/"
# C headers + modulemap are already embedded in the xcframework slices;
# no separate Bindings/include/ needed (avoids duplicate module errors).

echo ""
echo "Done. iOS artifacts staged in: $MODULE_DIR"
echo "  xcframework:   $MODULE_DIR/UniClipboardCore.xcframework"
echo "  Swift binding: $MODULE_DIR/Bindings/uc_mobile.swift"
