#!/usr/bin/env bash
# Reuse the Engine cache owner at an immutable automation revision.
# Keep this pin independent of the product's Engine dependency revision.
set -euo pipefail
revision=f44ae136f76a05e642fc22e32b823161f0716cef
root="${UC_TOOLS_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/uniclipboard-engine/tools}/cache-entry/$revision"
manifest="$(cat "$(dirname "${BASH_SOURCE[0]}")/engine-cache-tools.sha256")"
verify() (
  cd "$1"
  while read -r expected file; do
    if command -v sha256sum >/dev/null; then
      actual=$(sha256sum "$file" | cut -d' ' -f1)
    else
      actual=$(shasum -a 256 "$file" | cut -d' ' -f1)
    fi
    [[ "$actual" == "$expected" ]] || exit 1
  done <<< "$manifest"
)
if [[ ! -d "$root/scripts/build-cache" ]] || ! verify "$root" 2>/dev/null; then
  mkdir -p "$(dirname "$root")"
  staging=$(mktemp -d "$root.staging.XXXXXX")
  trap 'rm -rf "$staging"' EXIT
  mkdir -p "$staging/scripts/build-cache/bin"
  while read -r _checksum file; do
    mkdir -p "$staging/$(dirname "$file")"
    curl -fsSL --retry 3 -o "$staging/$file" \
      "https://raw.githubusercontent.com/UniClipboard/Engine/$revision/$file"
  done <<< "$manifest"
  verify "$staging"
  chmod +x "$staging/scripts/build-cache/bin/cargo"
  mkdir -p "$root/scripts/build-cache/bin"
  cp -R "$staging/." "$root/"
fi
if [[ "${1:-}" == --ci ]]; then
  exec bash "$root/scripts/build-cache/start-ci-mbx.sh"
fi
printf '%s\n' "$root"
