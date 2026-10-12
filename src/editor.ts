// SPDX-License-Identifier: LicenseRef-Proprietary
// Copyright (c) 2026 Gailleur. All rights reserved.

// WYSIWYG editing on top of Milkdown (ProseMirror). The editor owns a
// ProseMirror document; Markdown is produced only on demand. A document that
// was never changed reports `pristine`, so callers can keep the original
// bytes instead of re-serialising.

import { Editor, defaultValueCtx, editorViewCtx, editorViewOptionsCtx, rootCtx } from "@milkdown/kit/core";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { cursor } from "@milkdown/kit/plugin/cursor";
import { history } from "@milkdown/kit/plugin/history";
import { indent } from "@milkdown/kit/plugin/indent";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { trailing } from "@milkdown/kit/plugin/trailing";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { getMarkdown, replaceAll } from "@milkdown/kit/utils";

import { resolveRelative } from "./render";

export interface WysiwygOptions {
  dir: string | null;
  assetUrl: (path: string) => string;
  onChange: () => void;
}

export interface WysiwygEditor {
  readonly root: HTMLElement;
  getMarkdown(): string;
  /** True when the document equals what was last loaded. */
  isPristine(): boolean;
  setMarkdown(markdown: string): void;
  /** Text of the block containing the cursor; used to map positions across modes. */
  cursorBlockText(): string;
  /** Moves the cursor to the first block whose text matches. */
  selectBlockContaining(text: string): void;
  focus(): void;
  destroy(): Promise<void>;
}

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export async function createWysiwyg(container: HTMLElement, markdown: string, options: WysiwygOptions): Promise<WysiwygEditor> {
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, container);
      ctx.set(defaultValueCtx, markdown);
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
    if (!li || event.offsetX > 24 && event.target !== li) return;
    if (event.target !== li) return;
    const v = view();
    const pos = v.posAtDOM(li, 0);
    const $pos = v.state.doc.resolve(pos);
    const depth = $pos.depth;
    const node = $pos.node(depth);
    const nodePos = $pos.before(depth);
    if (node.type.name !== "list_item") return;
    v.dispatch(v.state.tr.setNodeMarkup(nodePos, undefined, { ...node.attrs, checked: !node.attrs["checked"] }));
    event.preventDefault();
  };
  container.addEventListener("click", onClick);

  return {
    root: container,
    getMarkdown: () => editor.action(getMarkdown()),
    isPristine: () => view().state.doc.eq(baseline),
    setMarkdown: (next) => {
      editor.action(replaceAll(next));
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
    focus: () => view().focus(),
    destroy: async () => {
      observer.disconnect();
      container.removeEventListener("click", onClick);
      await editor.destroy();
    },
  };
}
