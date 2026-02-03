#!/usr/bin/env bash
set -euo pipefail

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "Missing required env var: $name" >&2
    exit 1
  fi
}

normalize_repo() {
  local input="$1"
  local trimmed="${input#https://}"
  trimmed="${trimmed#http://}"
  trimmed="${trimmed#www.}"
  trimmed="${trimmed#github.com/}"
  trimmed="${trimmed#/}"
  if [ -z "$trimmed" ]; then
    echo "" >&2
    return 1
  fi
  echo "github.com/${trimmed}"
}
