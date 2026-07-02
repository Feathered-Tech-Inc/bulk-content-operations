#!/usr/bin/env bash

set -euo pipefail

EXAMPLE_FILE="build-release.sh.example"
TARGET_FILE="build-release.sh"

if [ ! -f "$EXAMPLE_FILE" ] || [ ! -f "$TARGET_FILE" ]; then
  echo "❌ Error: $EXAMPLE_FILE and $TARGET_FILE must both exist."
  exit 1
fi

normalize_file() {
  sed -E \
    -e 's|^APPLE_SIGNING_IDENTITY=.*$|APPLE_SIGNING_IDENTITY="__APPLE_SIGNING_IDENTITY__"|' \
    -e 's|^NOTARY_PROFILE=.*$|NOTARY_PROFILE="__NOTARY_PROFILE__"|' \
    "$1"
}

temp_example=$(mktemp)
temp_target=$(mktemp)
trap 'rm -f "$temp_example" "$temp_target"' EXIT

normalize_file "$EXAMPLE_FILE" > "$temp_example"
normalize_file "$TARGET_FILE" > "$temp_target"

if ! diff -u "$temp_example" "$temp_target" >/dev/null; then
  echo "❌ Error: $TARGET_FILE must match $EXAMPLE_FILE except for APPLE_SIGNING_IDENTITY and NOTARY_PROFILE values."
  echo "Please update $TARGET_FILE to keep it in sync with $EXAMPLE_FILE."
  exit 1
fi
