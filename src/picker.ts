// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

// Small popup menus anchored to the status bar: the block-type picker, and
// the actions on the current file.

import { BLOCK_CHOICES, type BlockType, type FormatKind } from "./format";

export interface Picker {
  readonly element: HTMLElement;
  close(): void;
}

export interface MenuItem {
  label: string;
  /** Shortcut shown at the right, already formatted for the platform. */
  key?: string;
  /** Highlighted as the current choice. */
  current?: boolean;
  /** Stored as `data-kind` on the item, for callers and tests. */
  kind?: string;
  onPick: () => void;
}

/**
 * Opens a menu above the status bar, aligned with `anchor`. The menu closes
 * itself after a pick, on Escape, or on a mousedown outside it (except on
 * `anchor`, whose own click toggles it).
 */
export function openMenu(anchor: HTMLElement, items: MenuItem[]): Picker {
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

  for (const choice of items) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "popup__item";
    item.setAttribute("role", "menuitem");
    if (choice.kind !== undefined) item.dataset["kind"] = choice.kind;
    if (choice.current) item.classList.add("popup__item--current");
    item.append(document.createTextNode(choice.label));
    if (choice.key) {
      const kbd = document.createElement("kbd");
      kbd.textContent = choice.key;
      item.append(kbd);
    }
    item.addEventListener("click", () => {
      close();
      choice.onPick();
    });
    element.appendChild(item);
  }

  document.body.appendChild(element);
  // Line the menu up with its anchor, kept inside the window.
  const left = anchor.getBoundingClientRect().left;
  const room = Math.max(window.innerWidth - element.offsetWidth - 8, 8);
  element.style.left = `${Math.min(Math.max(left, 8), room)}px`;
  document.addEventListener("mousedown", onOutside, true);
  document.addEventListener("keydown", onKey, true);
  (element.querySelector<HTMLButtonElement>(".popup__item--current") ?? element.querySelector<HTMLButtonElement>("button"))?.focus();

  return { element, close };
}

/** The block-type picker: `current` is highlighted; `onPick` receives the chosen kind. */
export function openBlockPicker(anchor: HTMLElement, current: BlockType | null, onPick: (kind: FormatKind) => void): Picker {
  return openMenu(
    anchor,
    BLOCK_CHOICES.map(([kind, label, key]) => ({
      label,
      key,
      kind,
      current: current === kind || (kind === "bullet" && current === "list"),
      onPick: () => onPick(kind),
    })),
  );
}
