// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

import { beforeEach, describe, expect, it, vi } from "vitest";

import { BLOCK_CHOICES } from "./format";
import { openBlockPicker, openMenu } from "./picker";

describe("openBlockPicker", () => {
  let anchor: HTMLButtonElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    anchor = document.createElement("button");
    document.body.appendChild(anchor);
  });

  it("lists every block choice and marks the current one", () => {
    const picker = openBlockPicker(anchor, "h2", () => {});
    const items = picker.element.querySelectorAll(".popup__item");
    expect(items.length).toBe(BLOCK_CHOICES.length);
    expect(picker.element.querySelector(".popup__item--current")?.textContent).toContain("Heading 2");
    expect(document.body.contains(picker.element)).toBe(true);
    picker.close();
  });

  it("treats a plain list as the bulleted choice", () => {
    const picker = openBlockPicker(anchor, "list", () => {});
    expect(picker.element.querySelector<HTMLElement>(".popup__item--current")?.dataset["kind"]).toBe("bullet");
    picker.close();
  });

  it("fires the pick and closes", () => {
    const onPick = vi.fn();
    const picker = openBlockPicker(anchor, "paragraph", onPick);
    picker.element.querySelector<HTMLButtonElement>('[data-kind="h1"]')!.click();
    expect(onPick).toHaveBeenCalledWith("h1");
    expect(document.body.contains(picker.element)).toBe(false);
  });

  it("closes on outside mousedown and on Escape, but not on the anchor", () => {
    const picker = openBlockPicker(anchor, null, () => {});
    anchor.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(document.body.contains(picker.element)).toBe(true);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(document.body.contains(picker.element)).toBe(false);

    const again = openBlockPicker(anchor, null, () => {});
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.body.contains(again.element)).toBe(false);
  });
});

describe("openMenu", () => {
  it("shows the given items with their shortcuts, fires a pick and closes", () => {
    document.body.innerHTML = "";
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    const onReload = vi.fn();
    const onCopy = vi.fn();
    const menu = openMenu(anchor, [
      { label: "Reload from Disk", key: "⌘R", onPick: onReload },
      { label: "Copy “notes.md” as Pathname", onPick: onCopy },
    ]);
    const items = menu.element.querySelectorAll<HTMLButtonElement>(".popup__item");
    expect(items.length).toBe(2);
    expect(items[0]?.textContent).toBe("Reload from Disk⌘R");
    expect(items[0]?.querySelector("kbd")?.textContent).toBe("⌘R");
    expect(items[1]?.textContent).toBe("Copy “notes.md” as Pathname");
    expect(items[1]?.querySelector("kbd")).toBeNull();
    items[1]?.click();
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onReload).not.toHaveBeenCalled();
    expect(document.body.contains(menu.element)).toBe(false);
  });
});
