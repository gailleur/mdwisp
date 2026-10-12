// SPDX-License-Identifier: LicenseRef-Proprietary
// Copyright (c) 2026 Gailleur Labs. All rights reserved.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { BLOCK_CHOICES } from "./format";
import { openBlockPicker } from "./picker";

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
