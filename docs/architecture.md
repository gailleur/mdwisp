# Architecture

## Shape

```
┌───────────────────────────────────────────────┐
│ Native shell (Rust, Tauri 2)                  │
│  menu · OS open-file events · open_document   │
│  print · PDF export · window state            │
├───────────────────────────────────────────────┤
│ System webview (WebKit / WebView2 / WebKitGTK)│
│  TypeScript, no framework                     │
│  tabs · render pipeline · find · theme        │
└───────────────────────────────────────────────┘
```

The shell is deliberately thin. All document logic lives in the frontend so
that it is portable and unit-testable with jsdom.

## Trust boundaries

1. **Document → renderer.** The document is untrusted. It becomes HTML via
   remark/rehype, then passes through DOMPurify (`src/sanitize.ts`) before it
   touches the DOM. `style` attributes survive only when they contain no
   `url(`, so KaTeX layout works but CSS cannot fetch anything. URL schemes
   are allow-listed. Mermaid output is embedded as an `<img>` with a `data:`
   URL — SVG inside an image element cannot run script.
2. **Renderer → shell.** The webview holds only the capabilities in
   `src-tauri/capabilities/default.json`. There is no `http` permission and no
   `shell` permission, so the frontend cannot reach the network or spawn
   processes even if compromised. File reads go through `open_document`,
   which grants read access only to the directory of a file the user chose.
3. **Shell → OS.** External links go through the opener plugin's default
   scope (`http`, `https`, `mailto`, `tel`). Nothing else is opened.

The Content Security Policy in `tauri.conf.json` backs all of this up at the
browser level: no `connect-src` except Tauri IPC, no frames, no workers, no
forms, scripts only from the bundle.

## Folder walks

The files sidebar lists one folder at a time and never walks the tree.
"Go to file" and "find in folder" do have to, so they live apart in
`src-tauri/src/folder.rs` and are held to a budget: they run on a blocking
thread, only when asked, look at Markdown files only, skip hidden folders
and `node_modules`, do not follow links to folders, and stop at fixed
limits (entries visited, files listed, lines reported, file size). Nothing
is indexed ahead of time or cached on disk. The file list is handed over
in one answer and kept by the frontend, which shows the previous list at
once and reads the folder again behind the panel. A search streams one
message per matching file over a Tauri channel, so results appear while
the walk is still going; each search carries an id, and a walk stops as
soon as its id is no longer the current one, which is how typing replaces
a search. Both commands refuse a folder the webview was not granted, as
`list_folder` does.

## PDF export

`src-tauri/src/pdf.rs` is the one place the shell touches the platform
webview directly. Each system webview can print to a file without a
dialog: AppKit's `NSPrintOperation` with a save-job disposition, WebView2's
`PrintToPdf`, and WebKitGTK's `WebKitPrintOperation` with the GTK file
printer. The bindings used are the crates Tauri already links, so the
dependency tree does not grow. Results come back over a channel because
WebView2 and WebKitGTK complete asynchronously on the main thread.

## Release

Every change lands on `main` through a pull request. Two rulesets guard the
branch: one requires the `ci-ok` check from `.github/workflows/ci.yml`, a
linear history and no force pushes, for everyone; the other requires a
pull request approved by the code owner, which the maintainer alone may
bypass, and only by merging a pull request. `ci-ok` passes when the type
check, lint and unit tests passed and the three-platform build with Clippy
and the shell tests either passed or was skipped because only `site/`
changed.

A release starts with `scripts/bump-version.sh X.Y.Z`, merged like any
other change. Pushing a `vX.Y.Z` tag then runs
`.github/workflows/release.yml`: it checks the tag against the version
fields, that the tagged commit is on `main` and that `ci-ok` passed on it
(waiting if CI is still running), builds installers on macOS, Linux and
Windows, writes `SHA256SUMS`, and opens a *draft* GitHub release holding all
of them. Publishing the draft is manual. The macOS build is signed with the
Developer ID certificate and notarized by Apple from the `APPLE_*` secrets;
Tauri does the signing, submission and stapling itself, and the workflow
re-checks the result with `codesign`, `spctl` and `stapler`. The release
job runs in the `release` environment, which only `v*` tags may use; the
signing secrets are meant to live there but are still repository secrets
today, so `docs/credentials.md` lists every one of them, where it lives and
how to move it. Forks never receive secrets and get an unsigned build. Windows builds are unsigned; the README explains how to
open them.

Publishing the release starts two more workflows. `linux-smoke.yml`
installs the previous release's Linux packages on Ubuntu runners and runs
the update check against the new one. The Mac App Store build is
`.github/workflows/appstore.yml`: it builds a universal binary with the App Sandbox
entitlements in `src-tauri/Entitlements.plist` merged in through
`tauri.appstore.conf.json`, signs it with the Apple Distribution identity,
wraps it with `productbuild` and uploads it with `altool`. The sandbox
carries the outgoing-connections entitlement only because WebKit's content
process renders nothing without it, even embedded pages; the Content
Security Policy remains what keeps the webview off the network.
`src-tauri/src/sandbox.rs` is the only code that knows about the sandbox:
it reports whether the app is sandboxed, and keeps folders the user grants
as security-scoped bookmarks. The frontend asks for a folder only when an
image beside a document actually fails to load, since the sandbox lets the
app list a granted file's folder but not read the files in it.
Inside the sandbox a save cannot create the temp file beside the target,
so `save_document` writes in place there.

### Updates

`src-tauri/src/update.rs` is the one place the app reaches the network on
its own, and only inside two commands the menu invokes: `check_update`
fetches `https://mdwisp.com/latest.json` through `tauri-plugin-updater`
(a Vercel rewrite of `latest.json` on the newest GitHub release) and
compares versions locally; `install_update` downloads the matching
bundle, verifies its minisign signature against `plugins.updater.pubkey`
in `tauri.conf.json`, installs it and relaunches. Nothing runs at launch
or on a timer, the endpoint URL carries none of the plugin's placeholders,
and the plugin's JavaScript API is not granted to the webview, so the
frontend can only ask the shell to run these two commands. The private key
lives with the Apple material outside the repository; CI signs with the
`TAURI_SIGNING_PRIVATE_KEY` secret and `tauri.release.conf.json` turns the
update bundles on. `scripts/latest-manifest.sh` writes the manifest with one
entry per installer kind (`darwin-aarch64`, `linux-x86_64-deb`,
`windows-x86_64-nsis`, …), so a deb install never receives an AppImage.
The App Store build detects the sandbox and offers the store page instead.
The About box's "Check for Updates…" on macOS is a `mdwisp://check-updates`
link in the panel's credits; the scheme is registered in `Info.plist` and
the running app receives it as `RunEvent::Opened`.

## Frontend modules

| Module | Role |
| --- | --- |
| `main.ts` | Boot: wire shell events, menu commands, drag-and-drop, tabs, the palette and the session. |
| `commands.ts` | Every command with its menu, title and shortcut: the command palette's list, typed so that a command without a handler does not compile. |
| `shell.ts` | The only module that imports Tauri APIs. Everything else is pure DOM/TS and runs in tests. |
| `tabs.ts` | Document tabs and the per-tab state machine: mode (reading / editor / source), buffer, baseline, dirty, save, disk-change conflicts, preview tabs. Opens are queued so one never overtakes another. |
| `session.ts` | Snapshot of the open documents (order, mode, position, zoom): one consumed by the relaunch after an update, one kept current for the next ordinary launch. |
| `document.ts` | Pure text helpers: LF/CRLF normalisation, final-newline preservation, untitled names. |
| `editor.ts` | Milkdown (ProseMirror) wrapper: pristine detection, image URL rewriting, task toggles, cursor anchoring. |
| `source.ts` | CodeMirror 6 wrapper with Markdown highlighting and search panel. |
| `format.ts` | Format action and block-type vocabulary shared by menu, shortcuts, status bar and both editors. |
| `outline.ts` | Sidebar rendering plus the Markdown heading scanner used in source mode. |
| `sidebar.ts` | What the left sidebars share: the resizable `<aside>`. |
| `explorer.ts` | Files sidebar: the lazy tree of one folder, which turns into find-in-folder and back. |
| `search.ts` | Find in folder: the field, the streamed results grouped by file, keyboard navigation. |
| `locate.ts` | From a matching source line to the place it was rendered, so a search result lands on the right occurrence. |
| `palette.ts` | The panel behind the command palette and "go to file": a field over a ranked list. |
| `fuzzy.ts` | Fuzzy matching and scoring for the palette. |
| `render.ts` | Markdown → sanitised HTML → DOM, then KaTeX, Mermaid, code-copy controls. |
| `sanitize.ts` | DOMPurify configuration and hooks. Unit-tested against hostile input. |
| `find.ts` | In-document search bar and highlighting; also how a find-in-folder result is shown in its document. |
| `theme.ts` | auto/light/dark with persistence. |
| `styles.css` | All styling; tokens on `:root`, dark via `data-theme` and `prefers-color-scheme`. |

## Why no framework

The UI is a tab strip, a document, a find bar and a theme button. A framework
would be the largest dependency in the bundle and would buy nothing. Direct
DOM code keeps the footprint small and the behaviour easy to audit.

## Editing model

Each tab holds a `text` buffer (LF-normalised) and a `baseline` (what is on
disk, with its line-ending convention). Exactly one of three surfaces is
mounted at a time: the rendered reading view, a Milkdown editor, or a
CodeMirror editor. Switching modes pulls the current buffer out of the
mounted surface, tears it down, and mounts the next. Save writes the buffer
through `save_document`, which is atomic.

A ProseMirror document that equals the one loaded is "pristine", and the
original text is kept rather than re-serialised. Dirty is therefore a
document-level comparison in the editor and a string comparison in source
mode. Milkdown and the reading view share remark for parsing, so what the
editor shows matches what the viewer renders.
