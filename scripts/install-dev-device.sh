#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
source "$SCRIPT_DIR/engine-build-storage.sh"
ENGINE_ROOT="${UC_ENGINE_REPOSITORY:-$PROJECT_ROOT/../Engine}"
LOCAL_ENGINE_ROOT="$PROJECT_ROOT/modules/uc-engine/.artifacts/local"
export PROJECT_ROOT SCRIPT_DIR LOCAL_ENGINE_BUILD_ROOT LOCAL_ENGINE_ROOT
INSTALL_ENGINE_COMMIT=""
DEFAULT_IOS_DEVICE="marks iPhone"
DEFAULT_ANDROID_DEVICE="7bac761b"

usage() {
  cat <<EOF
Install the UniClip development app on connected physical devices.

Usage:
  npm run install:dev
  npm run install:dev:ios [iOS device name or identifier]
  npm run install:dev:android [Android device identifier]
  bash scripts/install-dev-device.sh [ios|android|all] [device]

Defaults:
  iOS:     $DEFAULT_IOS_DEVICE
  Android: $DEFAULT_ANDROID_DEVICE

The app is built as the separate development version and does not replace the
production app. It uses the Engine revision pinned in modules/uc-engine/core-source.json
and reuses verified artifacts when available. This command does not start Metro; run npm start separately
when you need to load JavaScript from this checkout.
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command is unavailable: $1" >&2
    exit 1
  fi
}

assert_development_project() {
  local platform="$1"
  local expected_identifier
  local project_file

  case "$platform" in
    ios)
      expected_identifier='PRODUCT_BUNDLE_IDENTIFIER = app.uniclipboard.UniClipboard.dev;'
      project_file="$PROJECT_ROOT/ios/UniClipDev.xcodeproj/project.pbxproj"
      ;;
    android)
      expected_identifier="applicationId 'app.uniclipboard.android.dev'"
      project_file="$PROJECT_ROOT/android/app/build.gradle"
      ;;
  esac

  if [ ! -f "$project_file" ] || ! grep -Fq -- "$expected_identifier" "$project_file"; then
    echo "The $platform project is not prepared as the development app." >&2
    echo "Regenerate it with APP_VARIANT=development before installing." >&2
    exit 1
  fi
}

restore_pinned_ios_engine_impl() {
  local module_dir="$PROJECT_ROOT/modules/uc-engine"
  local pinned_version
  local cache_dir
  local archive
  local binding
  local module_framework="$module_dir/ios/UniClipboardEngine.xcframework"

  pinned_version="$(node -p "require('$module_dir/core-source.json').version")"
  cache_dir="$module_dir/.artifacts/$pinned_version"
  archive="$cache_dir/UniClipboardEngine.xcframework.zip"
  binding="$cache_dir/uc_engine_uniffi.swift"
  if [ ! -f "$archive" ] || [ ! -f "$binding" ]; then
    echo "The pinned iOS Engine cache is incomplete: $cache_dir" >&2
    return 1
  fi

  if [ -d "$module_framework" ]; then
    find "$module_framework" -depth -delete
  fi
  unzip -q "$archive" -d "$module_dir/ios"
  find "$module_framework" -name '._*' -delete
  cp "$binding" "$module_dir/ios/Bindings/uc_engine_uniffi.swift"
  node "$SCRIPT_DIR/verify-unified-engine-core.mjs" --prepared
}

restore_cached_local_ios_engine_impl() {
  local expected_commit="$1"
  local cache_dir="$LOCAL_ENGINE_ROOT/ios-cache"
  local module_dir="$PROJECT_ROOT/modules/uc-engine/ios"
  local module_framework="$module_dir/UniClipboardEngine.xcframework"
  local pending

  # The previous install may have restored the project's pinned framework while
  # leaving a marker for another source revision. Verify the actual pinned files
  # before recording them as the local input; never bless unverified files.
  if ! node "$SCRIPT_DIR/verify-unified-engine-core.mjs" --local-prepared --source-commit "$expected_commit" >/dev/null 2>&1 &&
      [ "$(node -p 'require(process.argv[1]).sourceCommit' "$PROJECT_ROOT/modules/uc-engine/core-source.json")" = "$expected_commit" ] &&
      node "$SCRIPT_DIR/verify-unified-engine-core.mjs" --prepared >/dev/null 2>&1; then
    local source_state
    source_state="$(node -p 'require(process.argv[1]).sourceStateSha256 || "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"' "$PROJECT_ROOT/modules/uc-engine/core-source.json")"
    node "$SCRIPT_DIR/verify-unified-engine-core.mjs" --record-local \
      --source-commit "$expected_commit" --source-state-sha256 "$source_state"
  fi

  # The build output directory is temporary. Reuse verified published files first.
  if node "$SCRIPT_DIR/verify-unified-engine-core.mjs" --local-prepared --source-commit "$expected_commit" >/dev/null 2>&1; then
    if ! node "$SCRIPT_DIR/verify-unified-engine-core.mjs" --local-prepared --local-artifacts "$cache_dir" --source-commit "$expected_commit" >/dev/null 2>&1; then
      pending="$(mktemp -d "$LOCAL_ENGINE_ROOT/ios-cache.XXXXXX")"
      ditto "$module_framework" "$pending/UniClipboardEngine.xcframework"
      cp "$module_dir/Bindings/uc_engine_uniffi.swift" "$pending/uc_engine_uniffi.swift"
      cp "$LOCAL_ENGINE_ROOT/local-prepared.json" "$pending/local-prepared.json"
      if ! node "$SCRIPT_DIR/verify-unified-engine-core.mjs" --local-prepared --local-artifacts "$pending" --source-commit "$expected_commit"; then
        rm -rf "$pending"
        return 1
      fi
      rm -rf "$cache_dir"
      mv "$pending" "$cache_dir"
    fi
    echo "Using prepared iOS Engine ($expected_commit); skipping Engine compilation"
    return
  fi

  if ! node "$SCRIPT_DIR/verify-unified-engine-core.mjs" --local-prepared --local-artifacts "$cache_dir" --source-commit "$expected_commit" >/dev/null 2>&1; then
    return 1
  fi
  echo "Restoring cached iOS Engine ($expected_commit); skipping Engine compilation"
  mkdir -p "$module_dir/Bindings"
  find "$module_framework" -depth -delete 2>/dev/null || true
  ditto "$cache_dir/UniClipboardEngine.xcframework" "$module_framework"
  cp "$cache_dir/uc_engine_uniffi.swift" "$module_dir/Bindings/uc_engine_uniffi.swift"
  cp "$cache_dir/local-prepared.json" "$LOCAL_ENGINE_ROOT/local-prepared.json"
  node "$SCRIPT_DIR/verify-unified-engine-core.mjs" --local-prepared --source-commit "$expected_commit"
}

export -f restore_pinned_ios_engine_impl
restore_pinned_ios_engine() {
  uc_engine_publish "$PROJECT_ROOT" bash -euo pipefail -c restore_pinned_ios_engine_impl
}

export -f restore_cached_local_ios_engine_impl
restore_cached_local_ios_engine() {
  uc_engine_publish "$PROJECT_ROOT" bash -euo pipefail -c 'restore_cached_local_ios_engine_impl "$@"' _ "$@"
}

prepare_local_cargo_home() {
  local cargo_home="${UC_ENGINE_STORAGE_BUILD_DIR:-$LOCAL_ENGINE_BUILD_ROOT}/cargo-home"
  local host_cargo_home="${CARGO_HOME:-${HOME:-}/.cargo}"
  local cache_name

  mkdir -p "$cargo_home"
  for cache_name in registry git; do
    if [ ! -e "$cargo_home/$cache_name" ] && [ -d "$host_cargo_home/$cache_name" ]; then
      ln -s "$host_cargo_home/$cache_name" "$cargo_home/$cache_name"
    fi
  done
  if [ ! -f "$cargo_home/config.toml" ]; then
    {
      printf '%s\n' '[build]'
      if command -v sccache >/dev/null 2>&1; then
        printf '%s\n' 'rustc-wrapper = "sccache"'
      fi
    } > "$cargo_home/config.toml"
  fi
  export CARGO_HOME="$cargo_home"
}

prepare_local_engine_cargo_config() {
  local worktree="$1"
  local cargo_config="$worktree/.cargo/config.toml"

  {
    printf '\n%s\n' '[patch."https://github.com/UniClipboard/Engine.git"]'
    printf 'uc-engine = { path = "%s/crates/uc-engine" }\n' "$worktree"
    printf 'uc-observability-contract = { path = "%s/crates/uc-observability-contract" }\n' "$worktree"
  } >> "$cargo_config"
}

prepare_install_engine() {
  local platform="$1"
  local android_marker="$LOCAL_ENGINE_BUILD_ROOT/uc-engine-uniffi-dist/android/source-commit.txt"
  local marker_file
  local prepared_commit
  local source_commit
  local worktree

  require_command git
  require_command node
  if [ ! -f "$ENGINE_ROOT/Cargo.toml" ]; then
    echo "Engine repository is not available: $ENGINE_ROOT" >&2
    echo "Set UC_ENGINE_REPOSITORY to its local path, then run this command again." >&2
    exit 1
  fi

  mkdir -p "$LOCAL_ENGINE_ROOT"
  prepare_local_cargo_home
  if [ -z "$INSTALL_ENGINE_COMMIT" ]; then
    INSTALL_ENGINE_COMMIT="$(node -p 'require(process.argv[1]).sourceCommit' "$PROJECT_ROOT/modules/uc-engine/core-source.json")"
    if ! git -C "$ENGINE_ROOT" cat-file -e "$INSTALL_ENGINE_COMMIT^{commit}"; then
      git -C "$ENGINE_ROOT" fetch origin "$INSTALL_ENGINE_COMMIT"
    fi
  fi
  source_commit="$INSTALL_ENGINE_COMMIT"
  case "$platform" in
    ios)
      if restore_cached_local_ios_engine "$source_commit"; then
        return
      fi
      ;;
    android)
      marker_file="$android_marker"
      prepared_commit="$(cat "$marker_file" 2>/dev/null || true)"
      if [ "$prepared_commit" = "$source_commit" ]; then
        return
      fi
      ;;
    *)
      echo "Unsupported Engine platform: $platform" >&2
      exit 2
      ;;
  esac

  echo "Preparing $platform Engine pinned by mobile ($source_commit)"
  worktree="$(mktemp -d "$LOCAL_ENGINE_ROOT/engine-install.XXXXXX")"
  rmdir "$worktree"
  git -C "$ENGINE_ROOT" worktree add --detach "$worktree" "$source_commit"
  prepare_local_engine_cargo_config "$worktree"
  trap 'git -C "$ENGINE_ROOT" worktree remove --force "$worktree"' RETURN
  case "$platform" in
    ios)
      UC_ENGINE_LOCAL_TARGET_DIR="$LOCAL_ENGINE_BUILD_ROOT" \
        bash "$SCRIPT_DIR/prepare-local-unified-engine-core.sh" "$worktree"
      restore_cached_local_ios_engine "$source_commit"
      ;;
    android)
      (
        cd "$worktree"
        UC_ENGINE_UNIFFI_TARGET_DIR="$LOCAL_ENGINE_BUILD_ROOT" \
          UC_ENGINE_UNIFFI_BUILD_LOCKED=1 \
          uc_engine_run_build bindings/uc-engine-uniffi/scripts/build-android-aar.sh
      )
      ;;
  esac
  trap - RETURN
  git -C "$ENGINE_ROOT" worktree remove --force "$worktree"
}

install_ios() {
  local device="$1"
  require_command xcrun
  require_command unzip

  if ! xcrun devicectl list devices 2>/dev/null | grep -Fq -- "$device"; then
    echo "iOS device is not available: $device" >&2
    echo "Unlock the phone, connect it, then try again or pass its name explicitly." >&2
    exit 1
  fi

  assert_development_project ios
  APP_VARIANT=development npx expo prebuild --platform ios --no-install
  trap 'status=$?; if restore_pinned_ios_engine; then restore_status=0; else restore_status=$?; fi; if [ "$status" -eq 0 ] && [ "$restore_status" -ne 0 ]; then status="$restore_status"; fi; exit "$status"' EXIT
  prepare_install_engine ios
  # Keep Expo C++ view layouts consistent with this Debug build and React Native.
  EXPO_USE_PRECOMPILED_MODULES=0 UC_ENGINE_LOCAL_CORE=1 npx pod-install ios
  node "$SCRIPT_DIR/prepare-ios-debug-frameworks.mjs" "$PROJECT_ROOT/ios/Pods"
  EXPO_USE_PRECOMPILED_MODULES=0 UC_ENGINE_LOCAL_CORE=1 APP_VARIANT=development npx expo run:ios --device "$device" --no-bundler
  restore_pinned_ios_engine
  trap - EXIT
}

install_android() {
  local device="$1"
  local apk_path="$PROJECT_ROOT/android/app/build/outputs/apk/debug/app-arm64-v8a-debug.apk"
  local engine_aar="$LOCAL_ENGINE_BUILD_ROOT/uc-engine-uniffi-dist/android/UniClipboardEngine.aar"
  require_command adb

  if [ "$(adb -s "$device" get-state 2>/dev/null || true)" != "device" ]; then
    echo "Android device is not available: $device" >&2
    echo "Connect and unlock the phone, enable USB debugging, then try again." >&2
    exit 1
  fi

  assert_development_project android
  prepare_install_engine android
  if [ ! -f "$engine_aar" ]; then
    echo "The local Android engine is missing: $engine_aar" >&2
    echo "Prepare the local Android engine before installing." >&2
    exit 1
  fi
  (cd "$PROJECT_ROOT/android" && UC_ENGINE_LOCAL_AAR="$engine_aar" ./gradlew :app:assembleDebug)
  if [ ! -f "$apk_path" ]; then
    echo "Android development app was not produced: $apk_path" >&2
    exit 1
  fi
  adb -s "$device" install -r "$apk_path"
  adb -s "$device" reverse tcp:8081 tcp:8081
  adb -s "$device" shell monkey -p app.uniclipboard.android.dev 1 >/dev/null
}

platform="${1:-all}"
device="${2:-}"

if [ "$#" -gt 2 ]; then
  usage >&2
  exit 2
fi

if [ "$device" = "--help" ] || [ "$device" = "-h" ]; then
  usage
  exit 0
fi

if [ "$platform" = "--help" ] || [ "$platform" = "-h" ]; then
  usage
  exit 0
fi

uc_engine_build_storage_enter "$PROJECT_ROOT" "${BASH_SOURCE[0]}" "$@"
LOCAL_ENGINE_BUILD_ROOT="$(uc_engine_build_target "$ENGINE_ROOT")"
export PROJECT_ROOT SCRIPT_DIR LOCAL_ENGINE_BUILD_ROOT

case "$platform" in
  --help|-h)
    usage
    exit 0
    ;;
  ios)
    install_ios "${device:-$DEFAULT_IOS_DEVICE}"
    ;;
  android)
    install_android "${device:-$DEFAULT_ANDROID_DEVICE}"
    ;;
  all)
    if [ -n "$device" ]; then
      echo "A device override is only supported when installing one platform." >&2
      exit 2
    fi
    install_ios "$DEFAULT_IOS_DEVICE"
    install_android "$DEFAULT_ANDROID_DEVICE"
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
