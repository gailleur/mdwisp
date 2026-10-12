# mdwisp — product specification

mdwisp is a minimalist, cross-platform Markdown viewer and editor. It is built
around three commitments: **security** (untrusted documents cannot run code or
reach the network), **privacy** (the application itself never makes a network
request), and a **tiny footprint** (native shell, system webview, no bundled
browser). It should feel lightweight and technical.

This document is the behavioural specification. It describes what the product
does, not how any other product does it. All implementation is original.

## 1. Platforms and shell

- macOS (Apple Silicon and Intel), Linux (x86_64, WebKitGTK 4.1), Windows 10+
  (WebView2).
- Native shell: Tauri 2. Frontend: TypeScript, no UI framework.
- One window, multiple documents as tabs. Closing the last tab leaves an empty
  window with an Open action; it does not quit the app on macOS.
- Window size and position persist between launches.

## 2. Files

- Opens `.md`, `.markdown`, `.mdown`, `.mkd`; registered as a handler for those
  extensions on every platform via the installer metadata.
- Open from: the OS (double-click / "Open with"), drag-and-drop onto the window,
  the File ▸ Open dialog (multi-select), and command-line arguments.
- A second launch while the app is running forwards its files to the running
  instance instead of starting a new one.
- A document already open is focused rather than opened twice.
- The document is read as UTF-8. Invalid bytes are replaced, never fatal.
- Nothing is ever written to disk unless the user explicitly saves (editor,
  phase 3) or exports.

## 3. Rendering

- CommonMark + GFM: tables, strikethrough, autolinks, task lists, footnotes.
- Task-list checkboxes render but are inert in view mode.
- Fenced code blocks keep their language class; a "copy" control copies the
  block's text. If the user has selected text inside the block, the control
  does not override the selection.
- Math: `$…$`, `$$…$$`, `\(…\)`, `\[…\]` rendered by KaTeX with bundled
  fonts. Errors render as the source, never throw.
- Mermaid: fenced blocks tagged `mermaid` render as diagrams at Mermaid's
  strict security level. The SVG is embedded as an image (`data:` URL), so
  diagram content can never execute script. Failures fall back to showing the
  source with a short message. Diagrams re-render when the theme changes.
- Raw HTML in the document is permitted only after sanitisation (see §6).
- Relative links and images resolve against the document's directory.
- The first `h1` becomes the tab title; otherwise the file name.
- The document is re-rendered when the file changes on disk (live reload),
  preserving the scroll position; if the user was at the bottom, they stay at
  the bottom.

## 4. Viewing

- Theme: auto (follows the OS), light, dark. Choice persists. A toggle button
  cycles auto → light → dark → auto and shows the current state. A keyboard
  shortcut does the same.
- Find in document: a bar with a text field, match counter ("n of m"),
  previous / next, and close. Enter advances, Shift+Enter goes back, Escape
  closes. Matches are highlighted; the active match is scrolled into view.
  Case-insensitive, literal (not regex).
- Zoom: Cmd/Ctrl + / − / 0.
- Links to `http(s)` open in the system browser. `mailto:` and similar open
  their system handler. Links to other Markdown files open in a new tab.
- Print via the system print dialog. PDF export is "Save as PDF" from that
  dialog on every platform (phase 4 may add a direct exporter).
- Reload on demand (Cmd/Ctrl+R) in addition to live reload.

## 5. Editing (phase 3 — not in the initial viewer release)

- WYSIWYG mode and source mode, toggleable, cursor position preserved.
- Save, Save As, dirty indicator in the tab, prompt on close with unsaved
  changes, detection of external changes while editing.
- Round-trip fidelity: a document opened and saved without edits is
  byte-identical.

## 6. Security model

- Strict Content Security Policy on the webview: `default-src 'none'`,
  scripts only from the bundle, no `connect-src`, no frames, no objects, no
  forms. Images may load from the bundle, the document's directory, and
  `data:` URLs. Remote (`http(s)`) images are allowed by default because
  documents commonly use them; a setting can disable them.
- Every rendered document passes through an HTML sanitiser that removes
  script, style, event handlers, and any URL scheme other than
  `http`, `https`, `mailto`, `tel`, and relative paths. `file:` and
  `javascript:` never survive.
- The shell grants the webview only the capabilities it needs: file read in
  the directories of opened documents, file dialogs, opening external URLs,
  window-state persistence. The HTTP capability is never granted, so even a
  bug in the frontend cannot make a network request.
- No temporary files: rendering happens in memory from the document string.

## 7. Privacy

- The application makes no network requests of its own: no update check, no
  telemetry, no crash reporting, no font or asset CDNs. All assets are bundled.
- The only network traffic that can ever occur is a remote image referenced
  by a document the user opened, and that can be switched off.
- No account, no identifiers, no analytics.

## 8. Footprint

- Installer under 15 MB per platform (excluding WebView2 bootstrap on Windows,
  which is a system component).
- Cold start under one second on current hardware.
- Idle memory under 100 MB with one document.

## 9. Non-goals (for now)

- Cloud sync, collaboration, plugins, themes marketplace, mobile.
