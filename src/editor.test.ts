// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

import { describe, expect, it } from "vitest";

import { createWysiwyg } from "./editor";
import { DEFAULT_FIND_OPTIONS, compilePattern, findMatches } from "./find";

async function mount(markdown: string) {
  document.body.innerHTML = "<article></article>";
  const container = document.querySelector("article")!;
  const editor = await createWysiwyg(container, markdown, { dir: null, assetUrl: (path) => path, onChange: () => undefined });
  const ranges = (query: string) => findMatches(container, compilePattern(query, DEFAULT_FIND_OPTIONS)!);
  return { editor, container, ranges };
}

describe("WysiwygEditor.replaceRanges", () => {
  it("replaces every range in one undoable step, keeping the marks of the text it replaces", async () => {
    const { editor, container, ranges } = await mount("A **bold cat** and a cat.\n\n```\ncat\n```\n");
    const found = ranges("cat");
    expect(found).toHaveLength(3);
    expect(editor.replaceRanges(found.map((range) => ({ range, text: "dog" })))).toBe(3);
    const markdown = editor.getMarkdown();
    expect(markdown).toContain("**bold dog**");
    expect(markdown).toContain("and a dog.");
    expect(markdown).toContain("```\ndog\n```");
    expect(markdown).not.toContain("cat");

    // One undo restores all three.
    const dom = container.querySelector<HTMLElement>(".ProseMirror")!;
    dom.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(editor.getMarkdown()).toBe("A **bold cat** and a cat.\n\n```\ncat\n```\n");
    await editor.destroy();
  });

  it("deletes for an empty replacement and skips ranges that no longer match the document", async () => {
    const { editor, ranges } = await mount("one cat two cat\n");
    const [first] = ranges("cat");
    // A range outside the editor is left alone.
    const stale = document.createRange();
    stale.selectNodeContents(document.createTextNode("cat"));
    expect(editor.replaceRanges([{ range: first!, text: "" }, { range: stale, text: "x" }])).toBe(1);
    expect(editor.getMarkdown().trim()).toBe("one  two cat");
    await editor.destroy();
  });
});
