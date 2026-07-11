#!/usr/bin/env bash
set -euo pipefail

: "${TAG:?TAG is required}"
: "${GITHUB_SHA:?GITHUB_SHA is required}"

existing=$(git ls-remote --tags origin "refs/tags/$TAG" "refs/tags/$TAG^{}" | \
  awk '$2 ~ /\^\{\}$/ { peeled=$1; next } { direct=$1 } END { print (peeled != "" ? peeled : direct) }')

if [[ -n "$existing" ]]; then
  if [[ "$existing" == "$GITHUB_SHA" ]]; then
    echo "$TAG already points to this commit; continuing"
    exit 0
  fi
  echo "$TAG already exists on a different commit" >&2
  exit 1
fi

remote_main=$(git ls-remote origin refs/heads/main | awk '{print $1}')
if [[ "$remote_main" != "$GITHUB_SHA" ]]; then
  echo "main changed while the release was building; start a new release run" >&2
  exit 1
fi

if [[ "${1:-}" == "--check" ]]; then
  echo "$TAG is available for this commit"
  exit 0
fi

git tag "$TAG" "$GITHUB_SHA"
git push origin "refs/tags/$TAG"
