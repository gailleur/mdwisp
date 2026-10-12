// SPDX-License-Identifier: LicenseRef-Proprietary
// Copyright (c) 2026 Gailleur Labs. All rights reserved.

// The status-bar block-type picker: a small popup menu listing block kinds.

import { BLOCK_CHOICES, type BlockType, type FormatKind } from "./format";

export interface Picker {
  readonly element: HTMLElement;
  close(): void;
}

/**
 * Opens the picker above the status bar. `current` is highlighted; `onPick`
 * receives the chosen kind. The picker closes itself after a pick, on
 * Escape, or on a mousedown outside it (except on `anchor`, whose own click
 * toggles it).
 */
export function openBlockPicker(anchor: HTMLElement, current: BlockType | null, onPick: (kind: FormatKind) => void): Picker {
  const element = document.createElement("div");
  element.className = "popup";
  element.setAttribute("role", "menu");

  const close = () => {
    element.remove();
    document.removeEventListener("mousedown", onOutside, true);
    document.removeEventListener("keydown", onKey, true);
  };
  const onOutside = (event: MouseEvent) => {
    const target = event.target as Node;
    if (!element.contains(target) && target !== anchor && !anchor.contains(target)) close();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  for (const [kind, label, key] of BLOCK_CHOICES) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "popup__item";
    item.setAttribute("role", "menuitem");
    item.dataset["kind"] = kind;
    const isCurrent = current === kind || (kind === "bullet" && current === "list");
    if (isCurrent) item.classList.add("popup__item--current");
    const kbd = document.createElement("kbd");
    kbd.textContent = key;
    item.append(document.createTextNode(label), kbd);
    item.addEventListener("click", () => {
      close();
      onPick(kind);
    });
    element.appendChild(item);
  }

  document.body.appendChild(element);
  document.addEventListener("mousedown", onOutside, true);
  document.addEventListener("keydown", onKey, true);
  (element.querySelector<HTMLButtonElement>(".popup__item--current") ?? element.querySelector<HTMLButtonElement>("button"))?.focus();

  return { element, close };
}
