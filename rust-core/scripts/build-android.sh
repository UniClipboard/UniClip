#!/usr/bin/env bash
# Cross-compile uc-mobile for Android and generate Kotlin bindings from the
# upstream uniclipboard monorepo, then stage into modules/uc-core/android/.
#
# Environment:
#   UC_RUST_REPO  — path to the uniclipboard monorepo (default: ~/MyProjects/uniclipboard)
#
# Prerequisites:
#   - cargo-ndk: cargo install cargo-ndk
#   - Android NDK (via Android Studio or ANDROID_NDK_HOME)
#   - Rust targets: rustup target add \
#       aarch64-linux-android armv7-linux-androideabi x86_64-linux-android

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUST_REPO="${UC_RUST_REPO:-$HOME/MyProjects/uniclipboard}"
OUTPUT_DIR="$REPO_ROOT/modules/uc-core/android"
BINDINGS_DIR="$OUTPUT_DIR/src/main/java"
JNILIB_DIR="$OUTPUT_DIR/src/main/jniLibs"

if [ ! -d "$RUST_REPO/crates/uc-mobile" ]; then
  echo "ERROR: UC_RUST_REPO not found at $RUST_REPO" >&2
  echo "Set UC_RUST_REPO to your uniclipboard monorepo path." >&2
  exit 1
fi

echo "==> Building from: $RUST_REPO"

echo "==> [1/3] Host cdylib (for uniffi-bindgen)"
(cd "$RUST_REPO" && cargo build -p uc-mobile)

echo "==> [2/3] Kotlin bindings (uniffi-bindgen library mode)"
(cd "$RUST_REPO" && cargo run -p uc-mobile --features bindgen-cli --bin uniffi-bindgen -- \
  generate --library target/debug/libuc_mobile.dylib \
  --language kotlin --out-dir "$BINDINGS_DIR")

echo "==> [3/3] Cross-compile (cargo-ndk)"
(cd "$RUST_REPO" && cargo ndk \
  -t arm64-v8a \
  -t armeabi-v7a \
  -t x86_64 \
  -o "$JNILIB_DIR" \
  build -p uc-mobile --release)

echo ""
echo "Done. Android artifacts staged in: $OUTPUT_DIR"
echo "  Kotlin bindings: $BINDINGS_DIR/uniffi/uc_mobile/uc_mobile.kt"
echo "  JNI libs:        $JNILIB_DIR/{arm64-v8a,armeabi-v7a,x86_64}/libuc_mobile.so"
