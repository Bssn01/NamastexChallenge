#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

GENIE_DIR="${GENIE_DIR:-$ROOT_DIR/genie}"
OMNI_DIR="${OMNI_DIR:-$ROOT_DIR/omni}"

GENIE_REPO_URL="${GENIE_REPO_URL:-${1:-}}"
OMNI_REPO_URL="${OMNI_REPO_URL:-${2:-}}"

GENIE_REPO_REF="${GENIE_REPO_REF:-}"
OMNI_REPO_REF="${OMNI_REPO_REF:-}"

clone_if_missing() {
  local name="$1"
  local target_dir="$2"
  local repo_url="$3"
  local repo_ref="$4"

  if [[ -d "$target_dir/.git" || -f "$target_dir/.git" ]]; then
    echo "$name already exists at $target_dir"
    return 0
  fi

  if [[ -d "$target_dir" ]] && [[ -n "$(find "$target_dir" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
    echo "$name directory exists and is not empty: $target_dir" >&2
    echo "Refusing to overwrite it." >&2
    return 1
  fi

  if [[ -z "$repo_url" ]]; then
    echo "Missing repository URL for $name. Set the environment variable or pass positional args." >&2
    return 1
  fi

  echo "Cloning $name into $target_dir"
  git clone "$repo_url" "$target_dir"

  if [[ -n "$repo_ref" ]]; then
    echo "Checking out $name ref $repo_ref"
    git -C "$target_dir" checkout "$repo_ref"
  fi
}

clone_if_missing "genie" "$GENIE_DIR" "$GENIE_REPO_URL" "$GENIE_REPO_REF"
clone_if_missing "omni" "$OMNI_DIR" "$OMNI_REPO_URL" "$OMNI_REPO_REF"
