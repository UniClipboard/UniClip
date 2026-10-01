#!/usr/bin/env bash
# Emulator-only check of the real SMS receive path with synthetic messages.
# `adb emu sms send` makes the emulator deliver a system SMS_RECEIVED broadcast; no real SMS,
# phone or personal device is involved. Usage: scripts/e2e-sms-code-auto-copy.sh emulator-5556 app.apk
set -euo pipefail
serial="${1:?emulator serial, e.g. emulator-5556}"
apk="${2:?path to the app apk}"
[[ "$serial" == emulator-* ]] || { echo "Refusing non-emulator device: $serial" >&2; exit 2; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
adb="$SDK/platform-tools/adb"
maestro="${MAESTRO_BIN:-$HOME/.local/share/mobile-e2e/2.10.0/maestro/bin/maestro}"
app_id="${APP_ID:-app.uniclipboard.android.dev}"
out="${OUT_DIR:-$ROOT/e2e/results/sms-auto-copy-$(date +%s)}"
mkdir -p "$out"
export MAESTRO_CLI_NO_ANALYTICS=1 MAESTRO_CLI_ANALYTICS_NOTIFICATION_SHOWN=true

run_flow() { # flow, extra -e args...
  local flow="$1"; shift
  "$maestro" --device "$serial" test --debug-output "$out" --test-output-dir "$out" \
    -e APP_ID="$app_id" "$@" "$ROOT/.maestro/emulator-sms/$flow"
}
sms() { "$adb" -s "$serial" emu sms send "$1" "$2"; sleep 8; }
# Only this app's notifications: the emulator's stock Messages app also posts the SMS text.
notifications() {
  "$adb" -s "$serial" shell dumpsys notification --noredact |
    awk -v pkg="pkg=$app_id" '/NotificationRecord\(/ { keep = index($0, pkg) > 0 } keep'
}
shade_shot() { # name
  "$adb" -s "$serial" shell cmd statusbar expand-notifications; sleep 2
  "$adb" -s "$serial" exec-out screencap -p > "$out/$1.png"
  "$adb" -s "$serial" shell cmd statusbar collapse
}
expect_notified() { notifications | grep -q "$1" || { echo "FAIL: no notification containing $1" >&2; exit 1; }; }
expect_silent() { ! notifications | grep -q "$1" || { echo "FAIL: unexpected notification containing $1" >&2; exit 1; }; }

"$adb" -s "$serial" uninstall "$app_id" >/dev/null 2>&1 || true
"$adb" -s "$serial" install "$apk"

# R1: switch never enabled -> nothing (checked after the first launch, before enabling)
"$adb" -s "$serial" shell monkey -p "$app_id" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
sleep 5
"$adb" -s "$serial" shell input keyevent KEYCODE_HOME
sms 5551234 "Your verification code is 111222"
expect_silent 111222; shade_shot r1-default-off-no-notification

# R6/R2 prerequisites: enable through the UI and grant permissions
run_flow enable-auto-copy.yaml

# R3 / R4: ignored messages
sms 5551234 "Your balance is 100 dollars"
sms 5551234 "Code 482915 or code 731064"
expect_silent 731064; expect_silent 482915; shade_shot r3-r4-ignored-no-notification

# R2 + R9: matching message while the app process is dead (killed, not force-stopped, so
# broadcasts are still delivered). No background clipboard access is configured, so the
# notification must show the code and a Copy action, and must NOT claim it was copied.
"$adb" -s "$serial" shell am kill "$app_id"
sms 5551234 "Your verification code is 482915. It expires in 5 minutes."
expect_notified 482915
expect_notified "Tap Copy to copy it"
shade_shot r2-notification-plaintext-code-needs-copy
"$adb" -s "$serial" shell cmd statusbar expand-notifications; sleep 2
run_flow tap-copy-action.yaml
sleep 6
expect_notified "Copied to clipboard"
shade_shot r2-notification-after-copy-action
run_flow assert-history-has-code.yaml -e SMS_CODE=482915
run_flow assert-clipboard-has-code.yaml -e SMS_CODE=482915

# R5: permission revoked in system settings -> ignored, switch reads off
"$adb" -s "$serial" shell pm revoke "$app_id" android.permission.RECEIVE_SMS
sms 5551234 "Your verification code is 333444"
expect_silent 333444
run_flow assert-auto-copy-off.yaml
echo "OK: results in $out"
