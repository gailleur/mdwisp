# Contributing

Thanks for looking. mdwisp is small on purpose; the bar for adding things
is "does this make opening a Markdown file safer, faster or simpler".

## Ground rules

- **No network.** The app makes no requests, ever. No update checks, no
  telemetry, no fonts or scripts from a CDN. Pull requests that add a
  network call will not be merged.
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
```

Open a pull request against `main`. CI runs the tests and builds on macOS,
Linux and Windows. Keep commits focused and describe *why* in the message.

## Licensing of contributions

mdwisp is licensed under the Apache License 2.0. By submitting a
contribution you agree that it is licensed under the same terms (see
section 5 of the license). Sign off each commit with `git commit -s` to
certify the [Developer Certificate of Origin](https://developercertificate.org/).
