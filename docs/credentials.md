# Credentials, keys and endpoints

Every secret the project depends on, every external API it talks to, and
where each one lives or must live. Nothing here is a value: this file names
things so they can be found, rotated and audited. The repository holds no
secret of any kind, and `git log` has never carried one (checked
7 November 2026, with secret-scanning push protection on since the start).

## The short version

| Thing | Where it lives | Who uses it |
|---|---|---|
| Apple Developer ID certificate (.p12) and its password | GitHub Actions secret | `release.yml`, via Tauri's signer |
| App Store Connect API key (.p8), key id, issuer id | GitHub Actions secret | `release.yml` (notarization), `appstore.yml` (upload) |
| Apple Distribution and Mac Installer identities (.p12), their password, the provisioning profile | GitHub Actions secret | `appstore.yml` |
| Updater signing key (minisign) and its password | GitHub Actions secret, plus one offline copy | `release.yml`; the matching public key is in `tauri.conf.json` |
| `GITHUB_TOKEN` | Issued per run by GitHub | every workflow |
| Vercel project link | `site/.vercel/project.json`, ignored by git | `vercel` CLI on the maintainer's machine |
| Vercel account | vercel.com, the maintainer's login | deploys from the GitHub integration |
| Apple Developer account, team `B4JFYKNF47` | developer.apple.com, the maintainer's login | issuing every certificate above |
| GitHub account `jfgailleur`, org `gailleur` | github.com | admin of the repository and its secrets |

The app itself holds no credential. It ships one public key and one URL.

## Secrets in GitHub Actions

All fourteen are stored at the repository level
(`github.com/gailleur/mdwisp` → Settings → Secrets and variables →
Actions). They are set as needed by the two workflows that sign and
publish; `ci.yml` and `linux-smoke.yml` use none of them.

### Developer ID signing and notarization (`release.yml`)

| Secret | What it is | Used by |
|---|---|---|
| `APPLE_CERTIFICATE` | The Developer ID Application certificate with its private key, as a base64 `.p12` | Tauri's macOS bundler (`codesign`) |
| `APPLE_CERTIFICATE_PASSWORD` | Password of that `.p12` | same |
| `APPLE_SIGNING_IDENTITY` | The certificate's common name, `Developer ID Application: … (B4JFYKNF47)` | same |
| `APPLE_API_KEY` | App Store Connect API key id (ten characters) | `notarytool`, `altool` |
| `APPLE_API_ISSUER` | App Store Connect API issuer id (a UUID) | same |
| `APPLE_API_KEY_CONTENT` | The `.p8` private key for that API key, as text | written to `$RUNNER_TEMP/AuthKey.p8` for the run |

### App Store upload (`appstore.yml`)

| Secret | What it is | Used by |
|---|---|---|
| `APPSTORE_DIST_P12` | Apple Distribution certificate with private key, base64 `.p12` | imported into a throwaway keychain for `codesign` |
| `APPSTORE_INSTALLER_P12` | 3rd Party Mac Developer Installer certificate, base64 `.p12` | same, for `productbuild` |
| `APPSTORE_P12_PASSWORD` | Password shared by both `.p12` files | `security import` |
| `APPSTORE_APP_IDENTITY` | Common name of the Distribution certificate | `APPLE_SIGNING_IDENTITY` for that build |
| `APPSTORE_INSTALLER_IDENTITY` | Common name of the Installer certificate | `productbuild --sign` |
| `APPSTORE_PROVISIONING_PROFILE` | The Mac App Store provisioning profile, base64 | written to `src-tauri/embedded.provisionprofile` (git-ignored) |
| `APPLE_API_KEY`, `APPLE_API_ISSUER`, `APPLE_API_KEY_CONTENT` | shared with `release.yml` | `altool --upload-app` |

### In-app updates (`release.yml`)

| Secret | What it is | Used by |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | The minisign secret key (the file's content) | Tauri signs every update bundle with it |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Its password | same |

Its public half is `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`
and is baked into every build. **This key is the one that cannot be
replaced quietly.** Lose it and no installed copy can ever accept an update
again; every user would have to download a new installer by hand. Keep an
offline copy outside GitHub (a password manager entry or an encrypted
drive) and treat a leak as a full incident: a stolen key lets an attacker
who can also serve `latest.json` (see below) ship a signed, malicious update.

### Where they must live

The workflows and `docs/architecture.md` describe the secrets as belonging
to the `release` environment, which only `v*` tags may use. That
environment exists and has the tag rule, but it holds **no secrets**: the
fourteen above are repository secrets, readable by any workflow run on any
branch of this repository, not only by tag builds. Moving them is the one
piece of housekeeping this file asks for:

1. Settings → Environments → `release` → Add secret, for each of the
   fourteen names, with the same value.
2. Delete the repository-level copies.
3. Make the tag rule mean something: anyone with write access could
   otherwise push a `v99.0.0` tag at a branch whose workflow exfiltrates
   the secrets. Either add a required reviewer on the `release`
   environment (the maintainer approves each tag build), or add a tag
   ruleset that restricts creating `v*` tags to the admin.
4. Run `release.yml` on the next tag and `appstore.yml` by hand to confirm.

No workflow change is needed: both jobs already declare
`environment: release`, and GitHub resolves `secrets.X` from the environment
first. Until this is done, the comments in `release.yml` and
`appstore.yml` and the "Release" section of `docs/architecture.md`
overstate the control; what protects the secrets today is the list below.

### What protects them today

- Forks never receive secrets, and every external contributor's workflow
  run needs manual approval (`approval_policy: all_external_contributors`).
- The repository has one admin (`jfgailleur`) and one read-only collaborator.
- `main` requires a pull request approved by the code owner plus the `ci-ok`
  check; a malicious workflow edit cannot land without the maintainer.
- Default workflow token permissions are `read`; each workflow raises them
  per job (`contents: write` only in the release job that creates the draft).
- Secret-scanning and push protection are on. Dependabot security updates
  are on.

## Tokens GitHub issues for free

`GITHUB_TOKEN` (`${{ github.token }}`) is minted per run and expires with it.
It is used to:

- read check runs in `release.yml` (`checks: read`);
- create the draft release and upload installers (`contents: write`, only
  in the `release` job);
- list and download releases in `linux-smoke.yml` (`contents: read`).

Nothing stores it. No personal access token or deploy key exists on the
repository (checked: zero deploy keys, zero webhooks).

Dependabot opens pull requests with its own token and has no Dependabot
secrets configured; it needs none, since all registries are public.

## Apple

Everything Apple-side belongs to team **B4JFYKNF47** (Gailleur Labs) and is
managed at developer.apple.com and appstoreconnect.apple.com under the
maintainer's Apple ID.

| Asset | Where issued | Expiry | Notes |
|---|---|---|---|
| Developer ID Application certificate | Certificates, Identifiers & Profiles | 5 years from issue | Re-export as `.p12` and update `APPLE_CERTIFICATE` when renewed |
| Apple Distribution certificate | same | 1 year | `APPSTORE_DIST_P12` |
| 3rd Party Mac Developer Installer certificate | same | 1 year | `APPSTORE_INSTALLER_P12` |
| Mac App Store provisioning profile for `com.gailleur.mdwisp` | same | 1 year | `APPSTORE_PROVISIONING_PROFILE`; regenerate after any certificate renewal |
| App Store Connect API key | Users and Access → Integrations | no expiry, revocable | Needs the Developer role for notarization and upload. The `.p8` can be downloaded once; `APPLE_API_KEY_CONTENT` is the only copy unless you kept the file |
| App record `id6822752985` | App Store Connect | | Linked from the store build's About box (`update::STORE_URL`) |

The bundle identifier `com.gailleur.mdwisp` and the `mdwisp` URL scheme are
registered in `src-tauri/tauri.conf.json` and `src-tauri/Info.plist`.
Entitlements are in `src-tauri/Entitlements.plist`; the team id is written
there in plain text, which is public information.

## Vercel (mdwisp.com)

| Item | Value or location |
|---|---|
| Team | `jf-gailleurs-projects` (`team_LiWj1vw3pB916mvt5Yd2Pk3b`) |
| Project | `mdwisp` (`prj_PKKdu1dhgFfwWpeMYugIRGHOwtSp`), root directory `site/`, Node 24 |
| Domains | `mdwisp.com` (production), `www.mdwisp.com` (308 to apex), `mdwisp.vercel.app` |
| Environment variables | none, in any environment |
| Deployment protection | Vercel Authentication on every preview URL; production custom domains public |
| Firewall | Vercel defaults only; no custom rules |
| Local link | `site/.vercel/project.json`, ignored by git, holds only the two ids above |

The site needs no credential at runtime. Both serverless functions call
GitHub's public, unauthenticated endpoints (60 requests per hour per IP,
which the edge cache keeps well under). If GitHub rate limits ever become a
problem, the fix is a fine-grained PAT with no scopes set as a Vercel
environment variable named for example `GITHUB_TOKEN`, read in
`site/api/*.js` and sent as `Authorization: Bearer`; it would be the
site's first secret, and this file should say so when it happens.

DNS for `mdwisp.com` is at the registrar and points at Vercel's anycast
addresses. The zone has no MX, SPF or DMARC record: no mail is sent from
the domain, and the site lists no `@mdwisp.com` address. Adding
`v=spf1 -all` and a `p=reject` DMARC record would stop anyone else from
sending mail that claims to be from it; cheap and worth doing.

## Public keys and fixed endpoints

These are not secrets, but they are the trust anchors. Changing any of them
is a release-breaking event and must be deliberate.

| What | Where | Why it matters |
|---|---|---|
| Updater public key (minisign, base64) | `src-tauri/tauri.conf.json` → `plugins.updater.pubkey` | Every installed copy verifies update bundles against it. Must match `TAURI_SIGNING_PRIVATE_KEY`. |
| Update endpoint | `src-tauri/tauri.conf.json` → `plugins.updater.endpoints`: `https://mdwisp.com/latest.json` | The only URL the app fetches on its own. Rewritten by `site/vercel.json` to `site/api/latest.js`, which proxies the newest GitHub release's `latest.json`. |
| Release source | `site/api/latest.js`, `site/api/downloads.js`: `github.com/gailleur/mdwisp/releases` | Hard-coded; the functions accept no input that changes the host. |
| Opener allow-list | `tauri-plugin-opener` default scope (`http`, `https`, `mailto`, `tel`) | What a document link may open. |
| Webview CSP | `src-tauri/tauri.conf.json` → `app.security.csp` | Keeps the webview off the network: `connect-src ipc:` only. |
| Site CSP and headers | `site/vercel.json` | Confirmed live on 7 November 2026: CSP, HSTS with preload, nosniff, no-referrer. |

## APIs the project calls

| Caller | API | Auth | When |
|---|---|---|---|
| mdwisp app (`src-tauri/src/update.rs`) | `GET https://mdwisp.com/latest.json`, then the bundle URL in the manifest (`github.com/gailleur/mdwisp/releases/download/…`) | none | Only on Help ▸ Check for Updates and the install that follows |
| mdwisp app, Mac App Store build | opens `https://apps.apple.com/app/id6822752985` in the browser | none | Same menu item, store build only |
| Windows installer | Microsoft's WebView2 bootstrapper | none | First install on a machine without the runtime |
| `site/api/latest.js` | `GET https://github.com/gailleur/mdwisp/releases/latest/download/latest.json` | none | On cache miss, every 5 minutes at most |
| `site/api/downloads.js` | `GET https://api.github.com/repos/gailleur/mdwisp/releases` | none | On cache miss, hourly at most |
| `site/index.html` | Vercel Web Analytics script, same origin | none | Every page view |
| `release.yml` | GitHub REST: check runs, releases | `GITHUB_TOKEN` | Tag push |
| `release.yml` | Apple notarization service | App Store Connect API key | Tag push, macOS job |
| `appstore.yml` | App Store Connect upload | App Store Connect API key | Release published, or by hand |
| `linux-smoke.yml` | GitHub REST: releases; `https://mdwisp.com/latest.json` from inside the installed app | `GITHUB_TOKEN` / none | Release published, or by hand |

## Rotation

| Credential | How |
|---|---|
| Any Apple certificate | Issue a new one in the developer portal, export `.p12`, update the secret(s) and, for App Store, regenerate the provisioning profile. Old certificate: revoke. Shipped apps stay valid. |
| App Store Connect API key | Revoke in App Store Connect, create a new key, update all three `APPLE_API_*` secrets. |
| Updater signing key | Do not, unless it leaked. If it did: generate a new pair (`pnpm tauri signer generate`), set the new secret, put the new public key in `tauri.conf.json`, ship one last release **signed with the old key** whose binary carries the new public key, then switch. Users who skip that bridge release must reinstall by hand. |
| `GITHUB_TOKEN` | Nothing to do; per-run. |
| Vercel | Remove and re-add the GitHub integration, or re-link with `vercel link` inside `site/`. |

## Checklist for a new maintainer machine

1. `gh auth login` with an account that is admin on `gailleur/mdwisp`.
2. `vercel login`, then `cd site && vercel link` to recreate
   `site/.vercel/project.json`.
3. Nothing else: builds from a laptop are unsigned by design, and a signed
   release only ever comes from a tag build in CI.
