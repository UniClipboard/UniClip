#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/uniclip-share-recipient-load.XXXXXX")"
trap 'rm -rf "${BUILD_DIR}"' EXIT

SWIFTC_BIN="${SWIFTC:-}"
if [[ -z "${SWIFTC_BIN}" ]]; then
  SWIFTC_BIN="$(command -v swiftc)"
fi

"${SWIFTC_BIN}" \
  "${PROJECT_DIR}/targets/share/RecipientLoadErrorPresentation.swift" \
  "${PROJECT_DIR}/scripts/share-recipient-load-presentation-tests.swift" \
  -o "${BUILD_DIR}/share-recipient-load-presentation-tests"

"${BUILD_DIR}/share-recipient-load-presentation-tests" "$@"
