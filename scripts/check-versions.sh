#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 Gailleur Labs
#
# The version is written in four places: package.json, tauri.conf.json,
# Cargo.toml and the mdwisp entry in Cargo.lock. This fails unless all four
# agree, and, given an argument, unless they equal it. CI runs it on every
# change so a half-finished bump is caught in the pull request; the release
# workflow runs it with the tag so a tag can never name another version.
#
#   scripts/check-versions.sh           # the four fields agree
#   scripts/check-versions.sh 0.1.12    # and they are all 0.1.12
set -euo pipefail
cd "$(dirname "$0")/.."

pkg=$(node -p 'require("./package.json").version')
conf=$(node -p 'require("./src-tauri/tauri.conf.json").version')
cargo=$(sed -n 's/^version = "\(.*\)"/\1/p' src-tauri/Cargo.toml | head -1)
lock=$(awk '/^name = "mdwisp"$/ { getline; print; exit }' src-tauri/Cargo.lock | sed 's/^version = "\(.*\)"/\1/')
want="${1:-$pkg}"

echo "want=$want package.json=$pkg tauri.conf.json=$conf Cargo.toml=$cargo Cargo.lock=$lock"
for found in "$pkg" "$conf" "$cargo" "$lock"; do
  if [ "$found" != "$want" ]; then
    echo "version fields disagree; run scripts/bump-version.sh $want" >&2
    exit 1
  fi
done
