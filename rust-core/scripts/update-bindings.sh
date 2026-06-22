#!/usr/bin/env bash
# Rebuild both iOS and Android artifacts from the upstream uniclipboard monorepo.
# Convenience wrapper around build-ios.sh and build-android.sh.
#
# Usage:
#   ./rust-core/scripts/update-bindings.sh          # both platforms
#   ./rust-core/scripts/update-bindings.sh ios       # iOS only
#   ./rust-core/scripts/update-bindings.sh android   # Android only

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM="${1:-both}"

case "$PLATFORM" in
  ios)
    "$SCRIPT_DIR/build-ios.sh"
    ;;
  android)
    "$SCRIPT_DIR/build-android.sh"
    ;;
  both)
    "$SCRIPT_DIR/build-ios.sh"
    echo ""
    echo "=========================================="
    echo ""
    "$SCRIPT_DIR/build-android.sh"
    ;;
  *)
    echo "Usage: $0 [ios|android|both]" >&2
    exit 1
    ;;
esac
