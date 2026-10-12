// SPDX-License-Identifier: LicenseRef-Proprietary
// Copyright (c) 2026 Gailleur Labs. All rights reserved.

// Source (plain Markdown) editing on CodeMirror 6.

import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, openSearchPanel, searchKeymap } from "@codemirror/search";
import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

import { headingLevel, type BlockType, type FormatKind } from "./format";

export interface SourceOptions {
  dark: boolean;
  onChange: () => void;
}

export interface SourceEditor {
  readonly root: HTMLElement;
  getText(): string;
  setText(text: string): void;
  cursorLineText(): string;
  /** 1-based line of the cursor. */
  cursorLine(): number;
  setCursorToLineContaining(text: string): void;
  goToLine(line: number): void;
  format(kind: FormatKind, arg?: string): void;
  blockType(): BlockType;
  setDark(dark: boolean): void;
  openSearch(): void;
  focus(): void;
  destroy(): void;
}

const theme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "var(--bg)", color: "var(--fg)", fontSize: "14px" },
  ".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "1.6", padding: "24px 0 96px" },
  ".cm-content": { maxWidth: "860px", margin: "0 auto", padding: "0 24px", caretColor: "var(--fg)" },
  ".cm-gutters": { backgroundColor: "var(--bg)", color: "var(--muted)", border: "none" },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--fg) 4%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--fg)" },
  "&.cm-focused .cm-cursor": { borderLeftColor: "var(--fg)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--accent) 25%, transparent) !important",
  },
  ".cm-panels": { backgroundColor: "var(--elevated)", color: "var(--fg)", borderColor: "var(--line)" },
  ".cm-panel input, .cm-panel button": { font: "12px var(--font)" },
  ".cm-searchMatch": { backgroundColor: "var(--mark)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--mark-active)" },
});

// One accent, greys for everything else — the same rule as the rest of the UI.
const highlight = HighlightStyle.define([
  { tag: t.heading, color: "var(--strong)", fontWeight: "600" },
  { tag: t.processingInstruction, color: "var(--muted)" },
  { tag: [t.link, t.url], color: "var(--accent)" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "600", color: "var(--strong)" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "var(--muted)" },
  { tag: t.monospace, color: "var(--fg)" },
  { tag: t.labelName, color: "var(--accent)" },
  { tag: [t.angleBracket, t.tagName, t.attributeName], color: "var(--muted)" },
  { tag: t.attributeValue, color: "var(--fg)" },
  { tag: t.quote, color: "var(--muted)" },
  { tag: t.contentSeparator, color: "var(--muted)" },
]);

const LINE_PREFIX = /^(\s*)((?:#{1,6}\s+)|(?:>\s*)|(?:[-*+]\s+(?:\[[ xX]\]\s+)?)|(?:\d+[.)]\s+))?/;

/** Replaces the block prefix of every selected line. `prefix` of "" clears it. */
function setLinePrefix(view: EditorView, prefix: string | ((index: number) => string)): void {
  const { from, to } = view.state.selection.main;
  const first = view.state.doc.lineAt(from).number;
  const last = view.state.doc.lineAt(to).number;
  const changes = [];
  for (let n = first, i = 0; n <= last; n += 1, i += 1) {
    const line = view.state.doc.line(n);
    const match = LINE_PREFIX.exec(line.text);
    const indent = match?.[1] ?? "";
    const existing = match?.[2] ?? "";
    const next = typeof prefix === "function" ? prefix(i) : prefix;
    changes.push({ from: line.from, to: line.from + indent.length + existing.length, insert: indent + next });
  }
  view.dispatch({ changes });
}

/** Wraps the selection (or inserts a pair) with inline markers. */
function wrapSelection(view: EditorView, open: string, close = open): void {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  const already = selected.startsWith(open) && selected.endsWith(close) && selected.length >= open.length + close.length;
  const insert = already ? selected.slice(open.length, selected.length - close.length) : `${open}${selected}${close}`;
  view.dispatch({
    changes: { from, to, insert },
    selection: already
      ? EditorSelection.range(from, from + insert.length)
      : EditorSelection.range(from + open.length, from + open.length + selected.length),
  });
}

function insertBlock(view: EditorView, text: string): void {
  const { to } = view.state.selection.main;
  const line = view.state.doc.lineAt(to);
  const lead = line.text.length > 0 ? "\n\n" : "";
  view.dispatch({ changes: { from: line.to, insert: `${lead}${text}` }, selection: { anchor: line.to + lead.length + text.length } });
}

export function createSource(container: HTMLElement, text: string, options: SourceOptions): SourceEditor {
  const darkness = new Compartment();
  const darkTheme = (dark: boolean) => EditorView.theme({}, { dark });

  const view = new EditorView({
    parent: container,
    state: EditorState.create({
      doc: text,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        drawSelection(),
        history(),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage }),
        syntaxHighlighting(highlight),
        highlightSelectionMatches(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        theme,
        darkness.of(darkTheme(options.dark)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) options.onChange();
        }),
      ],
    }),
  });

  const format = (kind: FormatKind, arg?: string) => {
    const level = headingLevel(kind);
    if (level) setLinePrefix(view, `${"#".repeat(level)} `);
    else {
      switch (kind) {
        case "paragraph": setLinePrefix(view, ""); break;
        case "bold": wrapSelection(view, "**"); break;
        case "italic": wrapSelection(view, "*"); break;
        case "strike": wrapSelection(view, "~~"); break;
        case "code": wrapSelection(view, "`"); break;
        case "link": {
          if (arg === undefined) break;
          const { from, to } = view.state.selection.main;
          const label = view.state.sliceDoc(from, to) || arg;
          view.dispatch({ changes: { from, to, insert: `[${label}](${arg})` } });
          break;
        }
        case "bullet": setLinePrefix(view, "- "); break;
        case "ordered": setLinePrefix(view, (i) => `${i + 1}. `); break;
        case "task": setLinePrefix(view, "- [ ] "); break;
        case "quote": setLinePrefix(view, "> "); break;
        case "codeblock": {
          const { from, to } = view.state.selection.main;
          const body = view.state.sliceDoc(from, to);
          view.dispatch({ changes: { from, to, insert: "```\n" + body + "\n```" }, selection: { anchor: from + 3 } });
          break;
        }
        case "hr": insertBlock(view, "---"); break;
        case "table": insertBlock(view, "| Column | Column |\n| --- | --- |\n|  |  |\n|  |  |"); break;
      }
    }
    view.focus();
  };

  const blockType = (): BlockType => {
    const line = view.state.doc.lineAt(view.state.selection.main.head).text;
    const m = LINE_PREFIX.exec(line)?.[2] ?? "";
    if (/^#{1,6}\s/.test(m)) return `h${m.trim().length}` as BlockType;
    if (m.startsWith(">")) return "quote";
    if (/\[[ xX]\]/.test(m)) return "task";
    if (m) return "list";
    return line.trim() ? "paragraph" : "paragraph";
  };

  return {
    root: view.dom,
    getText: () => view.state.doc.toString(),
    setText: (next) => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } });
    },
    cursorLineText: () => view.state.doc.lineAt(view.state.selection.main.head).text,
    cursorLine: () => view.state.doc.lineAt(view.state.selection.main.head).number,
    setCursorToLineContaining: (needle) => {
      const target = needle.trim();
      if (!target) return;
      const doc = view.state.doc;
      for (let n = 1; n <= doc.lines; n += 1) {
        const line = doc.line(n);
        if (line.text.includes(target)) {
          view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
          return;
        }
      }
    },
    goToLine: (n) => {
      const line = view.state.doc.line(Math.min(Math.max(n, 1), view.state.doc.lines));
      view.dispatch({
        selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: "start", yMargin: 24 }),
      });
      view.focus();
    },
    format,
    blockType,
    setDark: (dark) => view.dispatch({ effects: darkness.reconfigure(darkTheme(dark)) }),
    openSearch: () => openSearchPanel(view),
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}
