// SPDX-License-Identifier: LicenseRef-Proprietary
// Copyright (c) 2026 Gailleur Labs. All rights reserved.

// Source (plain Markdown) editing on CodeMirror 6.

import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, openSearchPanel, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";

export interface SourceOptions {
  dark: boolean;
  onChange: () => void;
}

export interface SourceEditor {
  readonly root: HTMLElement;
  getText(): string;
  setText(text: string): void;
  cursorLineText(): string;
  setCursorToLineContaining(text: string): void;
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
  ".cm-panels": { backgroundColor: "var(--chrome)", color: "var(--fg)", borderColor: "var(--border)" },
  ".cm-panel input, .cm-panel button": { font: "12px var(--font)" },
  ".cm-searchMatch": { backgroundColor: "var(--mark)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--mark-active)" },
});

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
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
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

  return {
    root: view.dom,
    getText: () => view.state.doc.toString(),
    setText: (next) => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } });
    },
    cursorLineText: () => view.state.doc.lineAt(view.state.selection.main.head).text,
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
    setDark: (dark) => view.dispatch({ effects: darkness.reconfigure(darkTheme(dark)) }),
    openSearch: () => openSearchPanel(view),
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}
