# Architecture

## Shape

```
┌───────────────────────────────────────────────┐
│ Native shell (Rust, Tauri 2)                  │
│  menu · OS open-file events · open_document   │
│  print · window state                         │
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

## Frontend modules

| Module | Role |
| --- | --- |
| `main.ts` | Boot: wire shell events, menu commands, drag-and-drop, tabs. |
| `shell.ts` | The only module that imports Tauri APIs. Everything else is pure DOM/TS and runs in tests. |
| `tabs.ts` | Document tabs: open, focus, close, title, live-reload watch per tab. |
| `render.ts` | Markdown → sanitised HTML → DOM, then KaTeX, Mermaid, code-copy controls. |
| `sanitize.ts` | DOMPurify configuration and hooks. Unit-tested against hostile input. |
| `find.ts` | In-document search bar and highlighting. |
| `theme.ts` | auto/light/dark with persistence. |
| `styles.css` | All styling; tokens on `:root`, dark via `data-theme` and `prefers-color-scheme`. |

## Why no framework

The UI is a tab strip, a document, a find bar and a theme button. A framework
would be the largest dependency in the bundle and would buy nothing. Direct
DOM code keeps the footprint small and the behaviour easy to audit.

## Phase 3 (editor) plan

Milkdown (ProseMirror) for WYSIWYG and CodeMirror 6 for source mode will
mount inside the same tab model. The remark pipeline is shared with Milkdown
so view and edit modes agree on parsing.
