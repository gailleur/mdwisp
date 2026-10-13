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

## PDF export

`src-tauri/src/pdf.rs` is the one place the shell touches the platform
webview directly. Each system webview can print to a file without a
dialog: AppKit's `NSPrintOperation` with a save-job disposition, WebView2's
`PrintToPdf`, and WebKitGTK's `WebKitPrintOperation` with the GTK file
printer. The bindings used are the crates Tauri already links, so the
dependency tree does not grow. Results come back over a channel because
WebView2 and WebKitGTK complete asynchronously on the main thread.

## Release

Pushing a `vX.Y.Z` tag runs `.github/workflows/release.yml`: it checks the
tag against the three version fields, builds installers on macOS, Linux and
Windows, writes `SHA256SUMS`, and opens a *draft* GitHub release holding all
of them. Publishing the draft is manual. The macOS build is signed with the
Developer ID certificate and notarized by Apple from the `APPLE_*`
repository secrets; Tauri does the signing, submission and stapling itself,
and the workflow re-checks the result with `codesign`, `spctl` and
`stapler`. Forks without the secrets get an unsigned build. Windows builds
are unsigned; the README explains how to open them.

## Frontend modules

| Module | Role |
| --- | --- |
| `main.ts` | Boot: wire shell events, menu commands, drag-and-drop, tabs. |
| `shell.ts` | The only module that imports Tauri APIs. Everything else is pure DOM/TS and runs in tests. |
| `tabs.ts` | Document tabs and the per-tab state machine: mode (reading / editor / source), buffer, baseline, dirty, save, disk-change conflicts. |
| `document.ts` | Pure text helpers: LF/CRLF normalisation, final-newline preservation, untitled names. |
| `editor.ts` | Milkdown (ProseMirror) wrapper: pristine detection, image URL rewriting, task toggles, cursor anchoring. |
| `source.ts` | CodeMirror 6 wrapper with Markdown highlighting and search panel. |
| `format.ts` | Format action and block-type vocabulary shared by menu, shortcuts, status bar and both editors. |
| `outline.ts` | Sidebar rendering plus the Markdown heading scanner used in source mode. |
| `render.ts` | Markdown → sanitised HTML → DOM, then KaTeX, Mermaid, code-copy controls. |
| `sanitize.ts` | DOMPurify configuration and hooks. Unit-tested against hostile input. |
| `find.ts` | In-document search bar and highlighting. |
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
