# Design

mdwisp follows the Gailleur Labs identity: near-black surfaces, a single
"matrix" green, monospace for anything technical, and no decoration that
does not carry information.

## Tokens

| Token | Dark (brand) | Light (paper) |
| --- | --- | --- |
| `--bg` | `#0a0a0a` | `#ffffff` |
| `--elevated` | `#161616` | `#f6f6f6` |
| `--fg` / `--strong` | `#e8e8e8` / `#ffffff` | `#161616` / `#000000` |
| `--muted` | `#8b8b8b` | `#6f6f6f` |
| `--line` | `#1f1f1f` | `#e4e4e4` |
| `--accent` | `#4ade80` | `#15803d` (AA on white) |
| `--accent-bright` | `#00ff41` | `#16a34a` |
| `--glow` | `0 0 8px rgba(74,222,128,.4)` | none |

Type: `Geist` when installed, else the system UI font; `JetBrains Mono` when
installed, else the system monospace. Nothing is downloaded — fonts are
never fetched.

## Layout

```
┌ bar ──────────────────────────────── 38px ┐  tabs, merged with the macOS
│ ● ● ●   demo.md ×   notes.md ×           │  title bar (drag region)
├───────────────────────────────────────────┤
│                                           │
│              document / editor            │  740px measure, centred
│                                           │
├ status ───────────────────────────── 24px ┤  mono, muted
│ reading ⌘1  ~/docs/demo.md    412 words LF ◐ auto │
└───────────────────────────────────────────┘
```

One accent colour does all the signalling: active tab underline, dirty dot,
links, task checks, mode label, find highlight, focus ring. Everything else
is a grey.

## Rules

- No floating controls over the document. Controls live in the bar or the
  status line.
- Hover reveals (tab close, code copy); nothing pulses or animates beyond a
  120 ms colour transition, and `prefers-reduced-motion` disables that.
- Errors are red-edged toasts that stay until dismissed or 10 s; status
  toasts are green-edged and brief. Messages are lowercase mono, like logs.
- The icon is the "wisp": a squared `m` whose last stroke dissolves into
  pixels, drawn in the same stroke and node language as the Gailleur Labs
  mark. `src-tauri/icons/source.svg` is the source; `pnpm tauri icon`
  regenerates the platform icons.
