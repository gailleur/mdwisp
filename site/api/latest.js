// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs
//
// Serves https://mdwisp.com/latest.json: the update manifest attached to
// the newest GitHub release, fetched server-side so the visitor's browser
// and the app's update check talk to this origin only. GitHub answers the
// "latest" download URL with two redirects, which a plain Vercel rewrite
// would hand back to the client; this follows them here instead. Cached at
// the edge for five minutes. No request data is read or stored.

const SOURCE = "https://github.com/gailleur/mdwisp/releases/latest/download/latest.json";

module.exports = async (req, res) => {
  let body;
  try {
    const upstream = await fetch(SOURCE, { redirect: "follow", headers: { "User-Agent": "mdwisp.com" } });
    if (!upstream.ok) {
      res.status(404).setHeader("Cache-Control", "public, max-age=60").end();
      return;
    }
    body = await upstream.text();
    JSON.parse(body);
  } catch {
    res.status(502).setHeader("Cache-Control", "no-store").end();
    return;
  }
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=3600");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.status(200).send(body);
};
