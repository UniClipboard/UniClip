#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
ENGINE_ROOT="${UC_ENGINE_REPOSITORY:-$PROJECT_ROOT/../Engine}"
LOCAL_ENGINE_ROOT="$PROJECT_ROOT/modules/uc-engine/.artifacts/local"
LOCAL_ENGINE_BUILD_ROOT="$LOCAL_ENGINE_ROOT/build"
LATEST_ENGINE_COMMIT=""
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
production app. It checks the local Engine against origin/main and only rebuilds
it when needed. This command does not start Metro; run npm start separately
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

prepare_latest_engine() {
  local platform="$1"
  local ios_marker="$LOCAL_ENGINE_BUILD_ROOT/uc-engine-uniffi-dist/ios/source-commit.txt"
  local android_marker="$LOCAL_ENGINE_BUILD_ROOT/uc-engine-uniffi-dist/android/source-commit.txt"
  local marker_file
  local prepared_commit
  local latest_commit
  local worktree

  require_command git
  require_command node
  if [ ! -f "$ENGINE_ROOT/Cargo.toml" ]; then
    echo "Engine repository is not available: $ENGINE_ROOT" >&2
    echo "Set UC_ENGINE_REPOSITORY to its local path, then run this command again." >&2
    exit 1
  fi

  mkdir -p "$LOCAL_ENGINE_ROOT"
  if [ -z "$LATEST_ENGINE_COMMIT" ]; then
    git -C "$ENGINE_ROOT" fetch origin main
    LATEST_ENGINE_COMMIT="$(git -C "$ENGINE_ROOT" rev-parse origin/main)"
  fi
  latest_commit="$LATEST_ENGINE_COMMIT"
  case "$platform" in
    ios) marker_file="$ios_marker" ;;
    android) marker_file="$android_marker" ;;
    *)
      echo "Unsupported Engine platform: $platform" >&2
      exit 2
      ;;
  esac
  prepared_commit="$(cat "$marker_file" 2>/dev/null || true)"
  if [ "$prepared_commit" = "$latest_commit" ]; then
    return
  fi

  echo "Preparing $platform Engine from origin/main ($latest_commit)"
  worktree="$(mktemp -d "$LOCAL_ENGINE_ROOT/engine-main.XXXXXX")"
  rmdir "$worktree"
  git -C "$ENGINE_ROOT" worktree add --detach "$worktree" "$latest_commit"
  trap 'git -C "$ENGINE_ROOT" worktree remove --force "$worktree"' RETURN
  case "$platform" in
    ios)
      UC_ENGINE_LOCAL_TARGET_DIR="$LOCAL_ENGINE_BUILD_ROOT" \
        bash "$SCRIPT_DIR/prepare-local-unified-engine-core.sh" "$worktree"
      ;;
    android)
      (
        cd "$worktree"
        UC_ENGINE_UNIFFI_TARGET_DIR="$LOCAL_ENGINE_BUILD_ROOT" \
          UC_ENGINE_UNIFFI_BUILD_LOCKED=1 \
          bindings/uc-engine-uniffi/scripts/build-android-aar.sh
      )
      ;;
  esac
  trap - RETURN
  git -C "$ENGINE_ROOT" worktree remove --force "$worktree"
}

install_ios() {
  local device="$1"
  require_command xcrun

  if ! xcrun devicectl list devices 2>/dev/null | grep -Fq -- "$device"; then
    echo "iOS device is not available: $device" >&2
    echo "Unlock the phone, connect it, then try again or pass its name explicitly." >&2
    exit 1
  fi

  assert_development_project ios
  prepare_latest_engine ios
  UC_ENGINE_LOCAL_CORE=1 APP_VARIANT=development npx expo run:ios --device "$device" --no-bundler
}

install_android() {
  local device="$1"
  local apk_path="$PROJECT_ROOT/android/app/build/outputs/apk/debug/app-arm64-v8a-debug.apk"
  local engine_aar="$PROJECT_ROOT/modules/uc-engine/.artifacts/local/build/uc-engine-uniffi-dist/android/UniClipboardEngine.aar"
  require_command adb

  if [ "$(adb -s "$device" get-state 2>/dev/null || true)" != "device" ]; then
    echo "Android device is not available: $device" >&2
    echo "Connect and unlock the phone, enable USB debugging, then try again." >&2
    exit 1
  fi

  assert_development_project android
  prepare_latest_engine android
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
