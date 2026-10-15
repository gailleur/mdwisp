// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

// WYSIWYG editing on top of Milkdown (ProseMirror). The editor owns a
// ProseMirror document; Markdown is produced only on demand. A document that
// was never changed reports `pristine`, so callers can keep the original
// bytes instead of re-serialising.

import {
  type CmdKey,
  Editor,
  defaultValueCtx,
  editorViewCtx,
  editorViewOptionsCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
} from "@milkdown/kit/core";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { cursor } from "@milkdown/kit/plugin/cursor";
import { history } from "@milkdown/kit/plugin/history";
import { indent } from "@milkdown/kit/plugin/indent";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { trailing } from "@milkdown/kit/plugin/trailing";
import {
  commonmark,
  createCodeBlockCommand,
  insertHrCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from "@milkdown/kit/preset/commonmark";
import { gfm, insertTableCommand, toggleStrikethroughCommand } from "@milkdown/kit/preset/gfm";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { callCommand, getMarkdown, replaceAll } from "@milkdown/kit/utils";

import { headingLevel, type BlockType, type FormatKind } from "./format";
import { resolveRelative } from "./render";

export interface WysiwygOptions {
  dir: string | null;
  assetUrl: (path: string) => string;
  onChange: () => void;
}

export interface EditorHeading {
  level: number;
  text: string;
  pos: number;
}

export interface WysiwygEditor {
  readonly root: HTMLElement;
  getMarkdown(): string;
  /** True when the document equals what was last loaded or saved. */
  isPristine(): boolean;
  setMarkdown(markdown: string): void;
  /**
   * Takes the current document as the new pristine state without touching
   * it, so a save leaves the cursor and undo history where they are.
   */
  markSaved(): void;
  /** Text of the block containing the cursor; used to map positions across modes. */
  cursorBlockText(): string;
  /** Moves the cursor to the first block whose text matches. */
  selectBlockContaining(text: string): void;
  /** Applies a Format-menu action at the selection. `arg` is the link href. */
  format(kind: FormatKind, arg?: string): void;
  blockType(): BlockType;
  headings(): EditorHeading[];
  /** Position of the heading containing or preceding the cursor, if any. */
  cursorPos(): number;
  goTo(pos: number): void;
  focus(): void;
  destroy(): Promise<void>;
}

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export async function createWysiwyg(container: HTMLElement, markdown: string, options: WysiwygOptions): Promise<WysiwygEditor> {
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, container);
      ctx.set(defaultValueCtx, markdown);
      // Serialise in the most common hand-written style so edits produce
      // small, predictable diffs.
      ctx.update(remarkStringifyOptionsCtx, (prev) => ({
        ...prev,
        bullet: "-" as const,
        listItemIndent: "one" as const,
        fences: true,
        rule: "-" as const,
        emphasis: "*" as const,
        strong: "*" as const,
      }));
      ctx.update(editorViewOptionsCtx, (prev) => ({
        ...prev,
        attributes: { class: "document editor", spellcheck: "true" },
      }));
      ctx.get(listenerCtx).updated(() => options.onChange());
    })
    .use(commonmark)
    .use(gfm)
    .use(history)
    .use(listener)
    .use(clipboard)
    .use(cursor)
    .use(indent)
    .use(trailing)
    .create();

  const view = (): EditorView => editor.action((ctx) => ctx.get(editorViewCtx));
  let baseline: ProseNode = view().state.doc;

  // ProseMirror renders image sources verbatim; rewrite document-relative
  // ones to loadable URLs. The node attribute (what gets serialised) is
  // untouched.
  const rewriteImages = () => {
    if (!options.dir) return;
    for (const img of container.querySelectorAll<HTMLImageElement>("img[src]")) {
      const src = img.getAttribute("src") ?? "";
      if (!src || HAS_SCHEME.test(src)) continue;
      const resolved = resolveRelative(options.dir, src);
      if (resolved) img.setAttribute("src", options.assetUrl(resolved));
    }
  };
  const observer = new MutationObserver(rewriteImages);
  observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
  rewriteImages();

  // Task-list checkboxes: clicking the marker area of a task item toggles it.
  const onClick = (event: MouseEvent) => {
    const li = (event.target as HTMLElement).closest<HTMLElement>('li[data-item-type="task"]');
    if (!li || event.target !== li) return;
    const v = view();
    const pos = v.posAtDOM(li, 0);
    const $pos = v.state.doc.resolve(pos);
    const node = $pos.node($pos.depth);
    const nodePos = $pos.before($pos.depth);
    if (node.type.name !== "list_item") return;
    v.dispatch(v.state.tr.setNodeMarkup(nodePos, undefined, { ...node.attrs, checked: !node.attrs["checked"] }));
    event.preventDefault();
  };
  container.addEventListener("click", onClick);

  const run = <T>(cmd: { key: CmdKey<T> }, payload?: T) => {
    editor.action(callCommand(cmd.key, payload));
  };

  /** Marks every list item in the selection as a task (unchecked). */
  const makeTaskList = () => {
    const v = view();
    const { from, to } = v.state.selection;
    const tr = v.state.tr;
    v.state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type.name === "list_item" && node.attrs["checked"] == null) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: false });
      }
      return true;
    });
    // Also cover the item containing a collapsed cursor.
    const $from = v.state.selection.$from;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const node = $from.node(depth);
      if (node.type.name === "list_item" && node.attrs["checked"] == null) {
        tr.setNodeMarkup($from.before(depth), undefined, { ...node.attrs, checked: false });
        break;
      }
    }
    if (tr.docChanged) v.dispatch(tr);
  };

  const format = (kind: FormatKind, arg?: string) => {
    const level = headingLevel(kind);
    if (level) {
      run(wrapInHeadingCommand, level);
    } else {
      switch (kind) {
        case "paragraph": run(turnIntoTextCommand); break;
        case "bold": run(toggleStrongCommand); break;
        case "italic": run(toggleEmphasisCommand); break;
        case "strike": run(toggleStrikethroughCommand); break;
        case "code": run(toggleInlineCodeCommand); break;
        case "link": if (arg !== undefined) run(toggleLinkCommand, { href: arg }); break;
        case "bullet": run(wrapInBulletListCommand); break;
        case "ordered": run(wrapInOrderedListCommand); break;
        case "task": run(wrapInBulletListCommand); makeTaskList(); break;
        case "quote": run(wrapInBlockquoteCommand); break;
        case "codeblock": run(createCodeBlockCommand); break;
        case "hr": run(insertHrCommand); break;
        case "table": run(insertTableCommand, { row: 3, col: 2 }); break;
      }
    }
    view().focus();
  };

  const blockType = (): BlockType => {
    const $from = view().state.selection.$from;
    const parent = $from.parent;
    if (parent.type.name === "heading") return `h${parent.attrs["level"] as number}` as BlockType;
    if (parent.type.name === "code_block") return "codeblock";
    for (let depth = $from.depth - 1; depth >= 0; depth -= 1) {
      const node = $from.node(depth);
      if (node.type.name === "list_item") return node.attrs["checked"] != null ? "task" : "list";
      if (node.type.name === "blockquote") return "quote";
    }
    return parent.type.name === "paragraph" ? "paragraph" : "other";
  };

  return {
    root: container,
    getMarkdown: () => editor.action(getMarkdown()),
    isPristine: () => view().state.doc.eq(baseline),
    setMarkdown: (next) => {
      editor.action(replaceAll(next));
      baseline = view().state.doc;
    },
    markSaved: () => {
      baseline = view().state.doc;
    },
    cursorBlockText: () => view().state.selection.$from.parent.textContent,
    selectBlockContaining: (text) => {
      const needle = text.trim();
      if (!needle) return;
      const v = view();
      let target: number | null = null;
      v.state.doc.descendants((node, pos) => {
        if (target !== null) return false;
        if (node.isTextblock && node.textContent.trim() === needle) {
          target = pos + 1;
          return false;
        }
        return true;
      });
      if (target !== null) {
        v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, target)).scrollIntoView());
      }
    },
    format,
    blockType,
    headings: () => {
      const out: EditorHeading[] = [];
      view().state.doc.descendants((node, pos) => {
        if (node.type.name === "heading") {
          out.push({ level: node.attrs["level"] as number, text: node.textContent, pos });
          return false;
        }
        return true;
      });
      return out;
    },
    cursorPos: () => view().state.selection.from,
    goTo: (pos) => {
      const v = view();
      const inside = Math.min(pos + 1, v.state.doc.content.size);
      v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, inside)));
      const dom = v.nodeDOM(pos);
      if (dom instanceof HTMLElement) dom.scrollIntoView({ block: "start" });
      v.focus();
    },
    focus: () => view().focus(),
    destroy: async () => {
      observer.disconnect();
      container.removeEventListener("click", onClick);
      await editor.destroy();
    },
  };
}
