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
- Math: `$…$` inline, `$$…$$` and ```` ```math ```` fences as display,
  recognised by the Markdown parser (remark-math) so their contents are
  never read as Markdown, then typeset by KaTeX with bundled fonts. Pandoc's
  rules apply to single dollars: the span hugs its contents and is not
  followed by a digit, so prices stay text. Errors render as the source,
  never throw.
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
- Outline: an optional left sidebar (⌘⌥S, View ▸ Outline Sidebar, or the outline button in the
  status bar) lists the document's headings with indentation. Clicking one
  jumps to it in whichever mode is active; the current section is
  highlighted as the reader scrolls or the cursor moves. The choice to show
  it persists.
- Headings carry stable ids (GitHub-style slugs) so `#anchor` links work.
- Links to `http(s)` open in the system browser. `mailto:` and similar open
  their system handler. Links to other Markdown files open in a new tab.
- Print via the system print dialog.
- Export PDF (Cmd/Ctrl+Shift+E) writes the reading view straight to a file
  through the platform webview's own print-to-file path (AppKit, WebView2,
  WebKitGTK), with the same print stylesheet as Print. No dialog beyond the
  save panel, no third-party PDF library.
- Reload on demand (Cmd/Ctrl+R) in addition to live reload.

- Help: a native **Help** menu (Cmd/Ctrl+/) opens an in-app, offline panel
  listing every shortcut, the editing commands and the known limits (for
  example that math and Mermaid are edited as text). Its footer and the
  platform About box link to gailleur.com and the repository; those open in
  the system browser on a click and are the only URLs in the app.
- Default app: every installer registers mdwisp for `.md`, `.markdown`,
  `.mdown` and `.mkd`. The first launch shows a one-line banner offering to
  make mdwisp the default; **File ▸ Use mdwisp for .md Files** does the same
  later. The default is never changed without that explicit choice. macOS
  confirms through its own dialog; Windows opens the Default apps settings
  page; Linux writes `mimeapps.list` (deb and rpm only, since an AppImage
  is not registered with the desktop).
- Folder access (Mac App Store build only): the sandboxed app can read the
  files the user opens, drops or saves, and nothing else. When a document
  renders images from its own folder and that folder is not readable, a
  one-line banner offers to grant it through the system folder dialog. A
  grant is remembered across launches; declining shows the document with
  broken images and does not ask again that session. The direct-download
  build is not sandboxed and reads a document's folder as before.

## 5. Editing

- Three modes per tab: reading (rendered), editor (WYSIWYG, ProseMirror via
  Milkdown) and source (CodeMirror). Cmd/Ctrl+1/2/3 switch; a pill in the
  corner shows the mode and cycles it. The cursor lands on the same block or
  line when switching between editor and source.
- In the editor, math and Mermaid blocks appear as their source text; the
  reading view renders them. This keeps a single KaTeX and keeps the editor
  small.
- Formatting is reachable three ways: a native **Format** menu (Paragraph,
  Heading 1–6, Bold, Italic, Strikethrough, Inline Code, Link, Bulleted /
  Numbered / Task list, Quote, Code Block, Horizontal Rule, Table) with
  shortcuts (⌘⌥0–6 for block types, ⌘B/⌘I/⌘E/⌘K, ⌘⇧7/9/L/./C); a
  block-type control in the status bar that shows the block at the cursor
  and opens a picker; and Markdown input rules in the editor (`# ` makes a
  heading). The same actions work in source mode as text transforms.
- Unsaved edits are previewed when switching to reading view; the file on
  disk is untouched until Save.
- New (untitled) documents open in the editor and ask for a location on
  first save. Save As moves the tab to the new path.
- Saves are atomic (temp file + rename). Only Markdown extensions may be
  written. Line endings (LF/CRLF) and the presence of a final newline are
  preserved from the original file.
- Dirty indicator in the tab and window title; prompt on tab close, window
  close and reload when there are unsaved changes.
- Autosave is an opt-in toggle (off by default); it saves one second after
  the last edit and never while a disk conflict is pending.
- External changes: if the file changes on disk and there are no unsaved
  edits, the buffer reloads. If there are unsaved edits, a banner offers
  "Reload from disk" or "Keep my changes" (the next save overwrites).
- Round-trip fidelity: a document opened and closed without edits is never
  written; a document edited in the WYSIWYG editor is serialised to
  normalised Markdown, so formatting may change (e.g. `*em*` → `_em_`). The
  source editor writes exactly what is in the buffer.
- Find works in reading and source modes everywhere, and in the editor on
  webviews with the CSS Custom Highlight API (Safari 17.2+, WebView2, recent
  WebKitGTK).

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

- The application makes no network requests of its own: no automatic update
  check, no telemetry, no crash reporting, no font or asset CDNs. All assets
  are bundled.
- Two kinds of network traffic can occur, both only on the user's explicit
  action: a remote image referenced by a document, which can be switched
  off; and *Help ▸ Check for Updates…*, which fetches a fixed manifest URL
  carrying no version or identifier, compares locally, and only on a second
  choice downloads and installs a signed release. Nothing runs at launch or
  on a timer. The Mac App Store build points at the store instead.
- No account, no identifiers, no analytics.

## 8. Footprint

- Installer under 15 MB per platform (excluding WebView2 bootstrap on Windows,
  which is a system component).
- Cold start under one second on current hardware.
- Idle memory under 100 MB with one document.

## 9. Non-goals (for now)

- Cloud sync, collaboration, plugins, themes marketplace, mobile.
