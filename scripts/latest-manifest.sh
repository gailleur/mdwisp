#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 Gailleur Labs
#
# Writes the update manifest the app reads from https://mdwisp.com/latest.json
# (a redirect to this file on the GitHub release). One entry per installer
# kind, keyed the way tauri-plugin-updater looks them up, each with the
# download URL and the minisign signature the build produced beside it.
#
#   scripts/latest-manifest.sh v0.1.4 out   # reads out/*.sig, writes out/latest.json
set -euo pipefail

tag="$1"
dir="$2"
version="${tag#v}"
base="https://github.com/gailleur/mdwisp/releases/download/$tag"

# Prints one platform entry if a signed file matching the pattern exists.
entry() {
  local key="$1" pattern="$2" file
  file=$(find "$dir" -maxdepth 1 -name "$pattern.sig" | head -1)
  [ -n "$file" ] || return 0
  file=$(basename "${file%.sig}")
  jq -n --arg key "$key" --arg url "$base/$file" --arg sig "$(cat "$dir/$file.sig")" \
    '{($key): {url: $url, signature: $sig}}'
}

platforms=$(
  {
    entry darwin-aarch64 '*.app.tar.gz'
    entry linux-x86_64-appimage '*.AppImage'
    entry linux-x86_64-deb '*.deb'
    entry linux-x86_64-rpm '*.rpm'
    entry windows-x86_64-nsis '*-setup.exe'
    entry windows-x86_64-msi '*.msi'
  } | jq -s 'add // {}'
)

if [ "$(jq 'length' <<<"$platforms")" -eq 0 ]; then
  echo "no signed installers in $dir; not writing a manifest" >&2
  exit 1
fi

jq -n --arg version "$version" --arg date "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --argjson platforms "$platforms" \
  '{version: $version, pub_date: $date, platforms: $platforms}' > "$dir/latest.json"
cat "$dir/latest.json"
