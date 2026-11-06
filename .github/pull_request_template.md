## What and why

<!-- What changes, and why it makes opening a Markdown file safer, faster or simpler. -->

## Checklist

- [ ] No new network request. The only one the app makes is the update check the user starts from the Help menu.
- [ ] No new Tauri capability, or the reason is written above.
- [ ] Anything rendered from a document goes through `src/sanitize.ts`, with a test for a new rendering path.
- [ ] Bundle size checked before and after if a dependency was added or changed.
- [ ] `pnpm typecheck`, `pnpm lint` and `pnpm test` pass; `cargo fmt` and `cargo clippy` are clean if the shell changed.
