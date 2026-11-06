# Contributing

Thanks for looking. mdwisp is small on purpose; the bar for adding things
is "does this make opening a Markdown file safer, faster or simpler".

## Ground rules

- **No network.** The app never makes a request on its own. No telemetry,
  no automatic update checks, no fonts or scripts from a CDN. The one
  exception is *Help ▸ Check for Updates…*, which runs only when the user
  chooses it. Pull requests that add a network call will not be merged.
- **No new Tauri capabilities** without a written reason in the PR. The
  webview gets the minimum permissions in `src-tauri/capabilities`.
- **Document content is hostile.** Anything rendered from a document goes
  through `src/sanitize.ts`; new rendering paths need a test there.
- **Small footprint.** Check the bundle size before and after. A dependency
  must earn its bytes.
- Keep the one-accent, no-decoration design in `docs/design.md`.

## Workflow

```sh
pnpm install
pnpm tauri dev          # run the app
pnpm test               # unit tests
pnpm typecheck
pnpm lint               # Biome, lint rules only
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Every change reaches `main` through a pull request; nobody pushes to it
directly, the maintainer included. Open the pull request against `main`
and fill in the checklist. It can be merged once two things are true:

- **CI is green.** The `ci-ok` check covers the type check, lint and unit
  tests, and, for anything outside `site/`, a build with Clippy and the
  shell tests on macOS, Linux and Windows. Workflows on a pull request from
  a fork wait for the maintainer to start them.
- **The maintainer approved it.** Every file is owned by @jfgailleur in
  `.github/CODEOWNERS`, and `main` requires the code owner's approval. A
  new push dismisses an earlier approval.

Keep commits focused and describe *why* in the message. Dependency updates
arrive as weekly Dependabot pull requests and go through the same gate.

## Releases

Releases are cut by the maintainer. `scripts/bump-version.sh X.Y.Z` writes
the version everywhere it lives; that change is merged like any other.
Pushing the tag `vX.Y.Z` on the merged commit then builds the installers,
but only if the tag matches the version, the commit is on `main` and CI
passed on it. See the Release section of
[docs/architecture.md](docs/architecture.md).

## Licensing of contributions

mdwisp is licensed under the Apache License 2.0. By submitting a
contribution you agree that it is licensed under the same terms (see
section 5 of the license). Sign off each commit with `git commit -s` to
certify the [Developer Certificate of Origin](https://developercertificate.org/).
