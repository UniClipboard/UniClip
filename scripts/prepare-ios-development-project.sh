#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
STAMP="$PROJECT_ROOT/.expo/ios-development-prepared.json"
INPUT_SHA256="$(node "$SCRIPT_DIR/ios-native-input-fingerprint.mjs" "$PROJECT_ROOT")"
PROJECT_FILE="$PROJECT_ROOT/ios/UniClipDev.xcodeproj/project.pbxproj"
POD_LOCK="$PROJECT_ROOT/ios/Podfile.lock"
POD_MANIFEST="$PROJECT_ROOT/ios/Pods/Manifest.lock"

stamp_matches() {
  node -e '
    const fs = require("node:fs");
    try {
      const marker = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      process.exit(marker.schemaVersion === 1 && marker.inputSha256 === process.argv[2] ? 0 : 1);
    } catch { process.exit(1); }
  ' "$STAMP" "$INPUT_SHA256"
}

if [[ -f "$PROJECT_FILE" && -f "$POD_LOCK" && -f "$POD_MANIFEST" ]] &&
   cmp -s "$POD_LOCK" "$POD_MANIFEST" && stamp_matches; then
  echo "Using prepared iOS development project; skipping Expo prebuild and pod install"
  exit 0
fi

rm -f "$STAMP"
APP_VARIANT=development npx expo prebuild --platform ios --no-install
RCT_IGNORE_PODS_DEPRECATION=0 RCT_SKIP_CODEGEN=0 EXPO_USE_PRECOMPILED_MODULES=0 \
  UC_ENGINE_LOCAL_CORE=1 npx pod-install ios
node "$SCRIPT_DIR/prepare-ios-debug-frameworks.mjs" "$PROJECT_ROOT/ios/Pods"

mkdir -p "$(dirname "$STAMP")"
INPUT_SHA256="$(node "$SCRIPT_DIR/ios-native-input-fingerprint.mjs" "$PROJECT_ROOT")"
node -e '
  const fs = require("node:fs");
  const path = process.argv[1];
  const pending = `${path}.${process.pid}.tmp`;
  fs.writeFileSync(pending, `${JSON.stringify({ schemaVersion: 1, inputSha256: process.argv[2] }, null, 2)}\n`);
  fs.renameSync(pending, path);
' "$STAMP" "$INPUT_SHA256"
