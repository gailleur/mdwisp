# mdwisp

A minimalist, cross-platform Markdown viewer adnd editor focused on security, 
privacy, and a tiny footprint.

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

## Installing

Installers for each release are attached to the GitHub release with a
`SHA256SUMS` file; check a download with `sha256sum -c SHA256SUMS`.

- **macOS**: the app is signed with a Developer ID certificate and
  notarized by Apple, so it opens like any other download. Drag it from
  the disk image to Applications.
- **Windows**: builds are not yet code-signed, so in the SmartScreen
  dialog choose *More info* → *Run anyway*.
  The installer fetches Microsoft's WebView2 runtime only if the machine
  lacks it (every supported Windows 10/11 ships with it). That is the one
  network action in the whole project, and it is the installer's, not the
  app's.
- **Linux**: `chmod +x` the AppImage, or install the `.deb`.

Every installer registers mdwisp as an application for `.md` files. Which
app is the *default* stays your choice: the first launch offers to make it
mdwisp, and *File ▸ Use mdwisp for .md Files* does the same later. On
Windows that opens the Default apps settings page, where you pick mdwisp
for `.md`; on Linux it needs the `.deb` or `.rpm`, since an AppImage is not
registered with the desktop.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities privately as
described in [SECURITY.md](SECURITY.md).

## License

Copyright 2026 Gailleur Labs. Licensed under the
[Apache License, Version 2.0](LICENSE). Bundled third-party components are
listed with their licenses in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

"mdwisp" and the wisp mark identify this project; the license does not
grant permission to use them for forks or derived products (section 6).
