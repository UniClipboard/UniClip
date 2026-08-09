#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/uniclip-share-staging.XXXXXX")"
trap 'rm -rf "${BUILD_DIR}"' EXIT

SWIFTC_BIN="${SWIFTC:-}"
if [[ -z "${SWIFTC_BIN}" ]]; then
  SWIFTC_BIN="$(command -v swiftc)"
fi

"${SWIFTC_BIN}" \
  "${PROJECT_DIR}/targets/_shared/AppSettings.swift" \
  "${PROJECT_DIR}/targets/_shared/Clipboard.swift" \
  "${PROJECT_DIR}/targets/_shared/ClipboardHistoryItem.swift" \
  "${PROJECT_DIR}/targets/_shared/SettingsStore.swift" \
  "${PROJECT_DIR}/targets/_shared/PayloadCache.swift" \
  "${PROJECT_DIR}/targets/share/OutboundShareHandoff.swift" \
  "${PROJECT_DIR}/scripts/share-staging-behavior-tests.swift" \
  -o "${BUILD_DIR}/share-staging-behavior-tests"

"${BUILD_DIR}/share-staging-behavior-tests" "$@"
