// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

import { beforeEach, describe, expect, it, vi } from "vitest";

import { openPalette, rankItems, type Palette, type PaletteItem } from "./palette";

const commands: PaletteItem[] = [
  { id: "open", label: "Open…", detail: "File", keys: "⌘O" },
  { id: "open-folder", label: "Open Folder…", detail: "File", keys: "⌘⇧O" },
  { id: "outline", label: "Toggle Outline Sidebar", detail: "View", keys: "⌘⌥S" },
  { id: "zoom-out", label: "Zoom Out", detail: "View" },
];

const files: PaletteItem[] = [
  { id: "/w/readme.md", label: "readme.md" },
  { id: "/w/docs/spec.md", label: "spec.md", detail: "docs" },
  { id: "/w/docs/deep/readme.md", label: "readme.md", detail: "docs/deep" },
  { id: "/w/archive/respect.md", label: "respect.md", detail: "archive" },
];

const ids = (ranked: ReturnType<typeof rankItems>) => ranked.map((r) => r.item.id);

function type(palette: Palette, text: string): void {
  const input = palette.element.querySelector<HTMLInputElement>(".palette__input")!;
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function press(palette: Palette, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  palette.element.querySelector<HTMLInputElement>(".palette__input")!.dispatchEvent(event);
  return event;
}

const labels = (palette: Palette) => Array.from(palette.element.querySelectorAll(".palette__label")).map((el) => el.textContent);
const activeId = (palette: Palette) => palette.element.querySelector<HTMLElement>(".palette__item--active")?.dataset["id"];

describe("rankItems", () => {
  it("returns the items in order, capped, when nothing is typed", () => {
    expect(ids(rankItems(commands, ""))).toEqual(["open", "open-folder", "outline", "zoom-out"]);
    expect(ids(rankItems(commands, "  ", " ", 2))).toEqual(["open", "open-folder"]);
  });

  it("puts the closest label first and drops what does not match", () => {
    expect(ids(rankItems(commands, "of"))).toEqual(["open-folder"]);
    expect(ids(rankItems(commands, "outl"))).toEqual(["outline"]);
    expect(ids(rankItems(commands, "open"))).toEqual(["open", "open-folder"]);
    expect(rankItems(commands, "xyz")).toEqual([]);
  });

  it("matches the detail and the label together, marking each part", () => {
    const [first] = rankItems(commands, "view zoom");
    expect(first?.item.id).toBe("zoom-out");
    expect(first?.detail).toEqual([0, 1, 2, 3]);
    expect(first?.label).toEqual([0, 1, 2, 3]);
  });

  it("reads a typed path across folder and file name", () => {
    expect(ids(rankItems(files, "docs/spec", "/"))).toEqual(["/w/docs/spec.md"]);
    expect(ids(rankItems(files, "deep/read", "/"))).toEqual(["/w/docs/deep/readme.md"]);
  });

  it("prefers a file name match to a match scattered through the path, and the shorter path on a tie", () => {
    expect(ids(rankItems(files, "spec", "/"))[0]).toBe("/w/docs/spec.md");
    expect(ids(rankItems(files, "readme", "/")).slice(0, 2)).toEqual(["/w/readme.md", "/w/docs/deep/readme.md"]);
  });
});

describe("openPalette", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("lists the items with details and shortcuts, the first one highlighted, and takes the focus", () => {
    const palette = openPalette({ label: "Commands", placeholder: "run a command", items: commands, onPick: () => {} });
    expect(labels(palette)).toEqual(["Open…", "Open Folder…", "Toggle Outline Sidebar", "Zoom Out"]);
    expect(palette.element.querySelector(".palette__keys")?.textContent).toBe("⌘O");
    expect(activeId(palette)).toBe("open");
    const input = palette.element.querySelector<HTMLInputElement>(".palette__input")!;
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("aria-activedescendant")).toBe(palette.element.querySelector(".palette__item--active")?.id);
    palette.close();
  });

  it("filters as you type and highlights the matched letters", () => {
    const palette = openPalette({ label: "Commands", placeholder: "", items: commands, onPick: () => {} });
    type(palette, "of");
    expect(labels(palette)).toEqual(["Open Folder…"]);
    expect(Array.from(palette.element.querySelectorAll(".palette__hit")).map((el) => el.textContent)).toEqual(["O", "F"]);
    type(palette, "nothing like this");
    expect(palette.element.querySelector(".palette__empty")?.textContent).toBe("no match");
    palette.close();
  });

  it("moves with the arrow keys, wrapping, and runs the highlighted item on Enter", () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    const palette = openPalette({ label: "Commands", placeholder: "", items: commands, onPick, onClose });
    press(palette, "ArrowDown");
    expect(activeId(palette)).toBe("open-folder");
    press(palette, "ArrowUp");
    press(palette, "ArrowUp");
    expect(activeId(palette)).toBe("zoom-out");
    expect(press(palette, "Enter").defaultPrevented).toBe(true);
    expect(onPick).toHaveBeenCalledWith(commands[3]);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.body.contains(palette.element)).toBe(false);
  });

  it("closes on Escape and on a press outside, without running anything, and gives the focus back", () => {
    const onPick = vi.fn();
    const before = document.createElement("button");
    document.body.appendChild(before);
    before.focus();
    const a = openPalette({ label: "Commands", placeholder: "", items: commands, onPick });
    press(a, "Escape");
    expect(document.body.contains(a.element)).toBe(false);
    expect(document.activeElement).toBe(before);

    const b = openPalette({ label: "Commands", placeholder: "", items: commands, onPick });
    b.element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(document.body.contains(b.element)).toBe(false);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("goes away when the focus goes elsewhere, and leaves the focus there", () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    const before = document.createElement("button");
    const editor = document.createElement("textarea");
    document.body.append(before, editor);
    before.focus();
    const palette = openPalette({ label: "Commands", placeholder: "", items: commands, onPick, onClose });
    editor.focus();
    expect(document.body.contains(palette.element)).toBe(false);
    expect(document.activeElement).toBe(editor);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("does not take the Enter that ends an input-method composition", () => {
    const onPick = vi.fn();
    const palette = openPalette({ label: "Commands", placeholder: "", items: commands, onPick });
    press(palette, "Enter", { isComposing: true });
    expect(onPick).not.toHaveBeenCalled();
    expect(document.body.contains(palette.element)).toBe(true);
    palette.close();
  });

  it("picks on a click", () => {
    const onPick = vi.fn();
    const palette = openPalette({ label: "Commands", placeholder: "", items: commands, onPick });
    palette.element.querySelector<HTMLElement>('.palette__item[data-id="outline"]')!.click();
    expect(onPick).toHaveBeenCalledWith(commands[2]);
  });

  it("takes new items while open, keeping the query and the highlighted row", () => {
    const palette = openPalette({ label: "Go to file", placeholder: "", items: files.slice(0, 1), joiner: "/", note: "indexing…", onPick: () => {} });
    expect(palette.element.querySelector(".palette__note")?.textContent).toBe("indexing…");
    type(palette, "readme");
    expect(labels(palette)).toEqual(["readme.md"]);
    palette.setItems(files);
    palette.setNote("");
    expect(labels(palette)).toEqual(["readme.md", "readme.md"]);
    expect(activeId(palette)).toBe("/w/readme.md");
    expect(palette.element.querySelector<HTMLElement>(".palette__note")?.hidden).toBe(true);
    palette.close();
  });

  it("says so when there is nothing to list", () => {
    const palette = openPalette({ label: "Go to file", placeholder: "", items: [], onPick: () => {} });
    expect(palette.element.querySelector(".palette__empty")?.textContent).toBe("nothing to show");
    expect(press(palette, "Enter").defaultPrevented).toBe(true);
    palette.close();
  });
});
