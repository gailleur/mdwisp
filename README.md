# mdwisp

A minimalist, cross-platform Markdown editor focused on security, privacy,
and a tiny footprint.

- **Secure** — documents are sanitised before rendering and the webview runs
  under a strict Content Security Policy. A document cannot run code.
- **Private** — the app never makes a network request. No update checks, no
  telemetry, no CDNs. Everything is bundled.
- **Light** — native shell on the system webview. No embedded browser.

Runs on macOS, Linux and Windows.

See [docs/spec.md](docs/spec.md) for the product specification and
[docs/architecture.md](docs/architecture.md) for how it is built.

## Development

Requirements: Rust (stable), Node 22, pnpm 9. On Linux, WebKitGTK 4.1 and
the usual Tauri system packages.

```sh
pnpm install
pnpm tauri dev          # run the app
pnpm test               # frontend unit tests
pnpm tauri build        # produce a platform installer in src-tauri/target
```

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities privately as
described in [SECURITY.md](SECURITY.md).

## License

Copyright 2026 Gailleur Labs. Licensed under the
[Apache License, Version 2.0](LICENSE). Bundled third-party components are
listed with their licenses in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

"mdwisp" and the wisp mark identify this project; the license does not
grant permission to use them for forks or derived products (section 6).
