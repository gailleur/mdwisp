#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 Gailleur Labs
#
# Writes a new version into the four places that carry it: package.json,
# tauri.conf.json, Cargo.toml and the mdwisp entry in Cargo.lock. Only the
# version strings change; the files keep their formatting. Commit the result
# on a branch and open a pull request; the tag comes after the merge.
#
#   scripts/bump-version.sh 0.1.12
set -euo pipefail
cd "$(dirname "$0")/.."

V="${1:-}"
if ! [[ "$V" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "usage: scripts/bump-version.sh X.Y.Z" >&2
  exit 2
fi
export V

# Without /g each substitution touches the first match only: the top-level
# "version" key in the JSON files and the [package] version in Cargo.toml.
perl -0pi -e 's/("version":\s*")[^"]*(")/$1$ENV{V}$2/' package.json src-tauri/tauri.conf.json
perl -0pi -e 's/^(version = ")[^"]*(")/$1$ENV{V}$2/m' src-tauri/Cargo.toml
perl -0pi -e 's/(name = "mdwisp"\nversion = ")[^"]*(")/$1$ENV{V}$2/' src-tauri/Cargo.lock

scripts/check-versions.sh "$V"
