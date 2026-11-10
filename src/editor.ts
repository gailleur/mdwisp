// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

// WYSIWYG editing on top of Milkdown (ProseMirror). The editor owns a
// ProseMirror document; Markdown is produced only on demand. A document that
// was never changed reports `pristine`, so callers can keep the original
// bytes instead of re-serialising. Front matter never enters ProseMirror:
// it is shown in a plain text field above the editor and put back in front
// of the Markdown, untouched unless that field was edited.

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
  imageSchema,
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

import type { ReplaceEdit } from "./find";
import { headingLevel, type BlockType, type FormatKind } from "./format";
import { FORMAT_LABEL, joinFrontMatter, splitFrontMatter, withInner, type FrontMatter, type SplitDocument } from "./frontmatter";
import { resolveRelative } from "./render";
import { isRemoteRef } from "./sanitize";

export interface WysiwygOptions {
  dir: string | null;
  assetUrl: (path: string) => string;
  /** Read whenever an image is drawn; a remote source is withheld while false. */
  allowRemoteImages: () => boolean;
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
  /**
   * Replaces the text of DOM ranges in the editor (find & replace) as one
   * undoable step. Returns how many were replaced; see `replaceRanges`.
   */
  replaceRanges(edits: ReplaceEdit[]): number;
  focus(): void;
  /** Re-applies the remote-image setting to the images on screen. */
  refreshImages(): void;
  /** How many images are withheld because remote content is off. */
  blockedRemoteImages(): number;
  destroy(): Promise<void>;
}

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export async function createWysiwyg(container: HTMLElement, markdown: string, options: WysiwygOptions): Promise<WysiwygEditor> {
  // ProseMirror writes an image node's `src` straight into the DOM, where
  // the webview would fetch it at once. Keep a remote source out of the
  // attribute until remote images are allowed; the node itself is untouched,
  // so what gets serialised never changes.
  const guardedImage = imageSchema.extendSchema((prev) => (ctx) => {
    const base = prev(ctx);
    return {
      ...base,
      toDOM: (node) => {
        const attrs: Record<string, string> = { ...(node.attrs as Record<string, string>) };
        const src = attrs["src"] ?? "";
        if (src && isRemoteRef(src) && !options.allowRemoteImages()) {
          delete attrs["src"];
          attrs["data-blocked-src"] = src;
        }
        return ["img", attrs];
      },
    };
  });

  // The front matter field sits above the editor Milkdown appends next.
  const matterHost = document.createElement("div");
  matterHost.className = "frontmatter frontmatter--editor";
  const matterLabel = document.createElement("label");
  matterLabel.className = "frontmatter__label";
  const matterCaption = document.createElement("span");
  const matterField = document.createElement("textarea");
  matterField.className = "frontmatter__editor";
  matterField.spellcheck = false;
  matterField.setAttribute("aria-label", "Front matter");
  matterLabel.append(matterCaption, matterField);
  matterHost.append(matterLabel);
  let matter: FrontMatter | null = null;
  // The blank lines between the block and the text, which the serialiser
  // would drop; put back so an edit elsewhere leaves that line alone.
  let matterGap = "";
  const fitField = () => {
    matterField.rows = Math.max(1, matterField.value.split("\n").length);
  };
  const showMatter = (split: SplitDocument) => {
    matter = split.matter;
    matterGap = matter ? /^\n*/.exec(split.body)?.[0] ?? "" : "";
    matterHost.hidden = matter === null;
    matterField.value = matter?.inner ?? "";
    matterCaption.textContent = matter ? `${FORMAT_LABEL[matter.format]} front matter` : "";
    fitField();
  };
  const currentMatter = (): FrontMatter | null => (matter ? withInner(matter, matterField.value) : null);
  const markdownOut = (): string => {
    const body = editor.action(getMarkdown());
    return matter ? joinFrontMatter(currentMatter(), matterGap + body) : body;
  };
  matterField.addEventListener("input", () => {
    fitField();
    options.onChange();
  });
  const initial = splitFrontMatter(markdown);
  showMatter(initial);

  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, container);
      ctx.set(defaultValueCtx, initial.body);
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
    .use(guardedImage)
    .use(gfm)
    .use(history)
    .use(listener)
    .use(clipboard)
    .use(cursor)
    .use(indent)
    .use(trailing)
    .create();
  container.prepend(matterHost);

  const view = (): EditorView => editor.action((ctx) => ctx.get(editorViewCtx));
  let baseline: ProseNode = view().state.doc;

  // Structural equality, which ProseMirror makes cheap because unchanged
  // nodes are shared, is the whole pristine check: nothing is serialised
  // on the edit path. The trailing plugin may add an empty paragraph after
  // the first transaction, which serialises to nothing, so it is ignored.
  const content = (doc: ProseNode) => {
    const last = doc.lastChild;
    const blank = last !== null && last.type.name === "paragraph" && last.content.size === 0 && doc.childCount > 1;
    return blank ? doc.content.cut(0, doc.content.size - last.nodeSize) : doc.content;
  };
  const pristine = () => content(view().state.doc).eq(content(baseline)) && currentMatter() === matter;

  // ProseMirror renders image sources verbatim; rewrite document-relative
  // ones to loadable URLs, and apply the remote-image setting to images
  // already on screen when it changes. The node attribute (what gets
  // serialised) is untouched.
  const rewriteImages = () => {
    const allowRemote = options.allowRemoteImages();
    for (const img of container.querySelectorAll<HTMLImageElement>("img")) {
      const blocked = img.getAttribute("data-blocked-src");
      if (blocked !== null) {
        if (allowRemote) {
          img.removeAttribute("data-blocked-src");
          img.setAttribute("src", blocked);
        }
        continue;
      }
      const src = img.getAttribute("src") ?? "";
      if (!src) continue;
      if (isRemoteRef(src)) {
        if (!allowRemote) {
          img.removeAttribute("src");
          img.setAttribute("data-blocked-src", src);
        }
        continue;
      }
      if (HAS_SCHEME.test(src) || !options.dir) continue;
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

  /**
   * Maps each range back to document positions and replaces its text, all in
   * one transaction, so a single undo restores everything. A range is
   * skipped unless it lies in editable content and the document holds
   * exactly the text the range shows there; replacements keep the marks
   * (bold, links, …) of the text they replace.
   */
  const replaceRanges = (edits: ReplaceEdit[]): number => {
    const v = view();
    const spans: { from: number; to: number; text: string }[] = [];
    for (const { range, text } of edits) {
      const node = range.startContainer;
      if (node !== range.endContainer || !v.dom.contains(node)) continue;
      const host = node.parentElement?.closest('[contenteditable="false"]');
      if (host && v.dom.contains(host)) continue;
      let from: number;
      let to: number;
      try {
        from = v.posAtDOM(node, range.startOffset);
        to = v.posAtDOM(node, range.endOffset);
      } catch {
        continue;
      }
      if (to <= from || v.state.doc.textBetween(from, to) !== range.toString()) continue;
      spans.push({ from, to, text });
    }
    if (spans.length === 0) return 0;
    // From the end backwards, so earlier positions stay valid.
    spans.sort((a, b) => b.from - a.from);
    const tr = v.state.tr;
    let last = Number.POSITIVE_INFINITY;
    let applied = 0;
    for (const { from, to, text } of spans) {
      if (to > last) continue; // overlapping; cannot happen with find's matches
      if (text) {
        // The marks of the replaced text, not any the user has armed at
        // the cursor (insertText would take those).
        const $from = tr.doc.resolve(from);
        const marks = $from.marksAcross(tr.doc.resolve(to)) ?? $from.marks();
        tr.replaceWith(from, to, v.state.schema.text(text, marks));
      } else {
        tr.delete(from, to);
      }
      last = from;
      applied += 1;
    }
    v.dispatch(tr);
    return applied;
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
    refreshImages: rewriteImages,
    blockedRemoteImages: () => container.querySelectorAll("img[data-blocked-src]").length,
    getMarkdown: markdownOut,
    isPristine: pristine,
    setMarkdown: (next) => {
      const split = splitFrontMatter(next);
      showMatter(split);
      editor.action(replaceAll(split.body));
      baseline = view().state.doc;
    },
    markSaved: () => {
      matter = currentMatter();
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
    replaceRanges,
    focus: () => view().focus(),
    destroy: async () => {
      observer.disconnect();
      container.removeEventListener("click", onClick);
      await editor.destroy();
      matterHost.remove();
    },
  };
}
