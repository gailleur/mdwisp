// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs
//
// Serves https://mdwisp.com/downloads.json: how many times the installers
// of every release have been fetched from GitHub, per platform, since the
// first release. The numbers are GitHub's own public per-file counters,
// added up here. They count files, not people: a first install, an in-app
// update and an automated test each count once. The app reports nothing,
// and no request data is read or stored. Cached at the edge for an hour.

const SOURCE = "https://api.github.com/repos/gailleur/mdwisp/releases";
const PAGE = 100;
const MAX_PAGES = 10;

/** The platform an asset installs on, or null for signatures, checksums and manifests. */
function platformOf(name) {
  if (/\.sig$/i.test(name)) return null;
  if (/\.dmg$|\.app\.tar\.gz$/i.test(name)) return "mac";
  if (/\.exe$|\.msi$/i.test(name)) return "windows";
  if (/\.deb$|\.rpm$|\.AppImage$/i.test(name)) return "linux";
  return null;
}

/** Adds up the published releases GitHub lists. */
function tally(releases) {
  const platforms = { mac: 0, windows: 0, linux: 0 };
  let since = null;
  for (const release of releases) {
    if (!release || release.draft) continue;
    const published = typeof release.published_at === "string" ? release.published_at : null;
    if (published && (since === null || published < since)) since = published;
    for (const asset of Array.isArray(release.assets) ? release.assets : []) {
      const platform = platformOf(String(asset.name ?? ""));
      const count = Number(asset.download_count);
      if (platform && Number.isFinite(count) && count > 0) platforms[platform] += count;
    }
  }
  return { since, total: platforms.mac + platforms.windows + platforms.linux, platforms };
}

async function allReleases() {
  const releases = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const res = await fetch(`${SOURCE}?per_page=${PAGE}&page=${page}`, {
      headers: { "User-Agent": "mdwisp.com", Accept: "application/vnd.github+json" },
    });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const batch = await res.json();
    if (!Array.isArray(batch)) throw new Error("unexpected answer");
    releases.push(...batch);
    if (batch.length < PAGE) break;
  }
  return releases;
}

module.exports = async (req, res) => {
  let body;
  try {
    body = tally(await allReleases());
  } catch {
    res.status(502).setHeader("Cache-Control", "no-store").end();
    return;
  }
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");
  res.status(200).send(JSON.stringify(body));
};

module.exports.platformOf = platformOf;
module.exports.tally = tally;
