#!/usr/bin/env bash
set -euo pipefail
PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/uniclip-extension-history.XXXXXX")"
trap 'rm -rf "${BUILD_DIR}"' EXIT
OUTPUT_DIR="${1:-${PROJECT_DIR}/e2e/results/extension-history}"
mkdir -p "${OUTPUT_DIR}"
python3 - "${PROJECT_DIR}" "${BUILD_DIR}/schema.sql" <<'PY'
import pathlib, re, sys
source = (pathlib.Path(sys.argv[1]) / 'src/platform/database/sqliteDatabase.ts').read_text()
schema = re.search(r'const CREATE_SCHEMA_V1 = `([\s\S]*?)`;', source).group(1)
pathlib.Path(sys.argv[2]).write_text(schema.replace('${TABLE_HISTORY}', 'clipboard_history'))
PY
"${SWIFTC:-swiftc}" \
  "${PROJECT_DIR}/targets/_shared/AppSettings.swift" \
  "${PROJECT_DIR}/targets/_shared/Clipboard.swift" \
  "${PROJECT_DIR}/targets/_shared/ClipboardHistoryItem.swift" \
  "${PROJECT_DIR}/targets/_shared/LegacyContainerMigrator.swift" \
  "${PROJECT_DIR}/targets/_shared/SettingsStoreLegacyMigration.swift" \
  "${PROJECT_DIR}/targets/_shared/SettingsStore.swift" \
  "${PROJECT_DIR}/targets/_shared/ExtensionStableIdentifier.swift" \
  "${PROJECT_DIR}/targets/_shared/HistoryDatabase.swift" \
  "${PROJECT_DIR}/scripts/extension-history-behavior-tests.swift" \
  -o "${BUILD_DIR}/extension-history-behavior-tests"
"${BUILD_DIR}/extension-history-behavior-tests" "${BUILD_DIR}/schema.sql" "${OUTPUT_DIR}"
