#!/usr/bin/env bash
# Usage: engine-source-checkout.sh <engine-repo> <worktree> <commit>
# Creates a detached worktree of the pinned Engine commit and populates its submodules.
# Engine keeps the network stack in a submodule, and a worktree of a single fetched commit
# leaves it empty, which would otherwise fail deep inside the Cargo build.
set -euo pipefail

engine_root="${1:?Engine repository}"
worktree="${2:?worktree path}"
commit="${3:?commit}"

git -C "$engine_root" worktree add --detach "$worktree" "$commit"
if [[ -f "$worktree/.gitmodules" ]]; then
  if ! git -C "$worktree" submodule update --init --recursive --depth 1; then
    paths="$(git -C "$worktree" config --file .gitmodules --get-regexp '\.path$' | awk '{print $2}' | tr '\n' ' ')"
    echo "Engine submodules could not be fetched for $commit: $paths" >&2
    git -C "$engine_root" worktree remove --force "$worktree" || true
    exit 1
  fi
fi
