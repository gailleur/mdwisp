# Third-party notices

mdwisp bundles the following open-source components. Each is used under its
own license, reproduced in the package's distribution and listed here.

| Component | License | Use |
| --- | --- | --- |
| Tauri (`tauri`, `tauri-build`, `@tauri-apps/api`, `@tauri-apps/cli`) | MIT / Apache-2.0 | Application shell |
| Tauri plugins (`fs`, `dialog`, `opener`, `window-state`, `single-instance`) | MIT / Apache-2.0 | File dialogs, file watching, external links, window persistence |
| unified, remark-parse, remark-gfm, remark-rehype, rehype-raw, rehype-stringify | MIT | Markdown parsing and HTML generation |
| DOMPurify | Apache-2.0 / MPL-2.0 | HTML sanitisation |
| Milkdown (`@milkdown/kit`) and ProseMirror | MIT | WYSIWYG editor |
| CodeMirror 6 and Lezer | MIT | Source editor |
| KaTeX | MIT | Math rendering (fonts bundled) |
| Mermaid | MIT | Diagram rendering |
| Vite, TypeScript, Vitest, jsdom | MIT | Build and test tooling (not shipped) |

Transitive Rust dependencies are enumerated by `cargo metadata`; transitive
npm dependencies by `pnpm licenses list`. All are under permissive licenses
(MIT, Apache-2.0, BSD, ISC, MPL-2.0, Unicode, Zlib). No copyleft component is
bundled.
