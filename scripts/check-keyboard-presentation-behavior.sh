#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/uniclip-keyboard-behavior.XXXXXX")"
trap 'rm -rf "${BUILD_DIR}"' EXIT

SWIFTC_BIN="${SWIFTC:-}"
if [[ -z "${SWIFTC_BIN}" ]]; then
  SWIFTC_BIN="$(command -v swiftc)"
fi

"${SWIFTC_BIN}" \
  "${PROJECT_DIR}/targets/keyboard/KeyboardLayoutMetrics.swift" \
  "${PROJECT_DIR}/targets/keyboard/KeyboardViewState.swift" \
  "${PROJECT_DIR}/targets/keyboard/KeyboardPresentationBehavior.swift" \
  "${PROJECT_DIR}/scripts/keyboard-presentation-behavior-tests.swift" \
  -o "${BUILD_DIR}/keyboard-presentation-behavior-tests"

"${BUILD_DIR}/keyboard-presentation-behavior-tests" "$@"
