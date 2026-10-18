// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

import { describe, expect, it, vi } from "vitest";

import { clampOutlineWidth, headingsFromMarkdown, Outline, OUTLINE_DEFAULT_WIDTH, OUTLINE_MIN_WIDTH } from "./outline";

describe("Outline resizing", () => {
  it("clamps the width to a readable minimum and a share of the window", () => {
    expect(clampOutlineWidth(50, 1200)).toBe(OUTLINE_MIN_WIDTH);
    expect(clampOutlineWidth(300, 1200)).toBe(300);
    expect(clampOutlineWidth(900, 1200)).toBe(600);
    expect(clampOutlineWidth(500, 600)).toBe(360);
    expect(clampOutlineWidth(Number.NaN, 1200)).toBe(OUTLINE_DEFAULT_WIDTH);
  });

  it("applies a restored width and reports a drag only when it changes something", () => {
    const onResize = vi.fn();
    const outline = new Outline(onResize);
    document.body.appendChild(outline.element);
    expect(outline.element.style.getPropertyValue("--outline-width")).toBe(`${OUTLINE_DEFAULT_WIDTH}px`);

    outline.setWidth(300);
    expect(outline.element.style.getPropertyValue("--outline-width")).toBe("300px");
    expect(onResize).not.toHaveBeenCalled();

    const handle = outline.element.querySelector<HTMLElement>(".outline__handle")!;
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();
    handle.hasPointerCapture = vi.fn(() => true);
    const pointer = (type: string, clientX: number) =>
      handle.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, clientX, button: 0 }), { pointerId: 1 }));
    pointer("pointerdown", 300);
    expect(document.body.classList.contains("is-resizing-outline")).toBe(true);
    pointer("pointermove", 340);
    expect(outline.element.style.getPropertyValue("--outline-width")).toBe("340px");
    pointer("pointerup", 340);
    expect(document.body.classList.contains("is-resizing-outline")).toBe(false);
    expect(onResize).toHaveBeenCalledWith(340);

    // Dragging below the minimum stops at the minimum.
    pointer("pointerdown", 340);
    pointer("pointermove", 0);
    pointer("pointerup", 0);
    expect(onResize).toHaveBeenLastCalledWith(OUTLINE_MIN_WIDTH);
    outline.element.remove();
  });
});

describe("headingsFromMarkdown", () => {
  it("collects ATX headings with levels and line numbers", () => {
    const h = headingsFromMarkdown("# One\n\ntext\n\n## Two ##\n### Three");
    expect(h).toEqual([
      { level: 1, text: "One", line: 1 },
      { level: 2, text: "Two", line: 5 },
      { level: 3, text: "Three", line: 6 },
    ]);
  });

  it("ignores headings inside fenced code", () => {
    const h = headingsFromMarkdown("# Real\n```\n# not a heading\n```\n~~~sh\n## nope\n~~~\n## Also real");
    expect(h.map((x) => x.text)).toEqual(["Real", "Also real"]);
  });

  it("requires a space after the hashes", () => {
    expect(headingsFromMarkdown("#hashtag\n#  spaced")).toEqual([{ level: 1, text: "spaced", line: 2 }]);
  });
});
