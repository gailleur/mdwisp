// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

// The palette: a text field over a list, filtered as you type. The command
// palette and "go to file" are the same panel with different items. Focus
// stays in the field; the arrow keys move the highlighted row and Enter
// takes it.

import { fuzzyMatch } from "./fuzzy";

export interface PaletteItem {
  id: string;
  /** What the row is: a command's name, a file's name. */
  label: string;
  /** Muted context beside it: a command's menu, a file's folder. */
  detail?: string;
  /** Shortcut shown at the right edge. */
  keys?: string;
}

export interface RankedItem {
  item: PaletteItem;
  /** Indices of the matched letters, for highlighting. */
  label: number[];
  detail: number[];
}

/** How much a match in the label is preferred to one that needs the detail as well. */
const LABEL_BONUS = 4;
const DEFAULT_LIMIT = 60;

/**
 * The items matching `query`, best first, at most `limit`. The label is
 * tried first; only when it does not match on its own are detail and
 * label matched together. `joiner` is what stands between the two then:
 * "/" for paths, so that "docs/spec" reads as typed. With no query the
 * items come back in order.
 */
export function rankItems(items: readonly PaletteItem[], query: string, joiner = " ", limit = DEFAULT_LIMIT): RankedItem[] {
  if (!query.trim()) return items.slice(0, limit).map((item) => ({ item, label: [], detail: [] }));

  const scored: Array<{ item: PaletteItem; index: number; score: number; whole: boolean; length: number }> = [];
  items.forEach((item, index) => {
    const combined = item.detail ? `${item.detail}${joiner}${item.label}` : item.label;
    const own = fuzzyMatch(query, item.label);
    const both = own || !item.detail ? null : fuzzyMatch(query, combined);
    if (own) scored.push({ item, index, score: own.score + LABEL_BONUS, whole: false, length: combined.length });
    else if (both) scored.push({ item, index, score: both.score, whole: true, length: combined.length });
  });
  scored.sort((a, b) => b.score - a.score || a.length - b.length || a.index - b.index);

  return scored.slice(0, limit).map(({ item, whole }) => {
    if (!whole) return { item, label: fuzzyMatch(query, item.label, true)?.positions ?? [], detail: [] };
    const detail = item.detail ?? "";
    const offset = detail.length + joiner.length;
    const positions = fuzzyMatch(query, `${detail}${joiner}${item.label}`, true)?.positions ?? [];
    return {
      item,
      detail: positions.filter((p) => p < detail.length),
      label: positions.filter((p) => p >= offset).map((p) => p - offset),
    };
  });
}

export interface PaletteOptions {
  /** Accessible name of the panel, and the field's placeholder. */
  label: string;
  placeholder: string;
  items: readonly PaletteItem[];
  /** See `rankItems`. */
  joiner?: string;
  /** A quiet line under the list: a count, "indexing…", a hint. */
  note?: string;
  onPick: (item: PaletteItem) => void;
  onClose?: () => void;
}

export interface Palette {
  readonly element: HTMLElement;
  close(): void;
  /** Replaces the items, keeping the query and, if it is still listed, the highlighted row. */
  setItems(items: readonly PaletteItem[]): void;
  setNote(note: string): void;
}

let serial = 0;

/** Text with the letters at `positions` wrapped for highlighting. */
function highlighted(text: string, positions: number[], className: string): HTMLElement {
  const span = document.createElement("span");
  span.className = className;
  if (positions.length === 0) {
    span.textContent = text;
    return span;
  }
  const marked = new Set(positions);
  let run = "";
  let runMarked = false;
  const flush = () => {
    if (!run) return;
    if (runMarked) {
      const hit = document.createElement("b");
      hit.className = "palette__hit";
      hit.textContent = run;
      span.appendChild(hit);
    } else {
      span.appendChild(document.createTextNode(run));
    }
    run = "";
  };
  for (let i = 0; i < text.length; i += 1) {
    const isMarked = marked.has(i);
    if (isMarked !== runMarked) {
      flush();
      runMarked = isMarked;
    }
    run += text[i];
  }
  flush();
  return span;
}

export function openPalette(options: PaletteOptions): Palette {
  const joiner = options.joiner ?? " ";
  const id = `palette-${(serial += 1)}`;
  const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let items = options.items;
  let shown: RankedItem[] = [];
  let active = 0;

  const element = document.createElement("div");
  element.className = "palette";

  const panel = document.createElement("div");
  panel.className = "palette__panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", options.label);

  const input = document.createElement("input");
  input.type = "text";
  input.className = "palette__input";
  input.placeholder = options.placeholder;
  input.spellcheck = false;
  input.autocomplete = "off";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-label", options.label);
  input.setAttribute("aria-expanded", "true");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", `${id}-list`);

  const list = document.createElement("div");
  list.className = "palette__list";
  list.id = `${id}-list`;
  list.setAttribute("role", "listbox");

  const note = document.createElement("p");
  note.className = "palette__note";
  const setNote = (text: string) => {
    note.textContent = text;
    note.hidden = text === "";
  };
  setNote(options.note ?? "");

  panel.append(input, list, note);
  element.appendChild(panel);

  const rows = () => Array.from(list.querySelectorAll<HTMLElement>(".palette__item"));

  const setActive = (index: number, scroll = true) => {
    const all = rows();
    if (all.length === 0) {
      active = 0;
      input.removeAttribute("aria-activedescendant");
      return;
    }
    active = ((index % all.length) + all.length) % all.length;
    all.forEach((row, i) => {
      row.classList.toggle("palette__item--active", i === active);
      row.setAttribute("aria-selected", i === active ? "true" : "false");
    });
    const row = all[active]!;
    input.setAttribute("aria-activedescendant", row.id);
    if (scroll && typeof row.scrollIntoView === "function") row.scrollIntoView({ block: "nearest" });
  };

  const render = (keepId?: string) => {
    shown = rankItems(items, input.value, joiner);
    list.replaceChildren();
    if (shown.length === 0) {
      const empty = document.createElement("p");
      empty.className = "palette__empty";
      empty.textContent = items.length === 0 ? "nothing to show" : "no match";
      list.appendChild(empty);
    }
    shown.forEach((entry, index) => {
      const row = document.createElement("div");
      row.className = "palette__item";
      row.id = `${id}-item-${index}`;
      row.setAttribute("role", "option");
      row.dataset["id"] = entry.item.id;
      row.appendChild(highlighted(entry.item.label, entry.label, "palette__label"));
      if (entry.item.detail) row.appendChild(highlighted(entry.item.detail, entry.detail, "palette__detail"));
      if (entry.item.keys) {
        const keys = document.createElement("kbd");
        keys.className = "palette__keys";
        keys.textContent = entry.item.keys;
        row.appendChild(keys);
      }
      list.appendChild(row);
    });
    const kept = keepId === undefined ? -1 : shown.findIndex((entry) => entry.item.id === keepId);
    setActive(kept >= 0 ? kept : 0);
    list.scrollTop = kept >= 0 ? list.scrollTop : 0;
  };

  const close = (giveFocusBack = true) => {
    if (!element.isConnected) return;
    element.remove();
    if (giveFocusBack && returnTo?.isConnected) returnTo.focus();
    options.onClose?.();
  };

  const pick = (index: number) => {
    const entry = shown[index];
    if (!entry) return;
    close();
    options.onPick(entry.item);
  };

  input.addEventListener("input", () => render());
  // The panel lives on its field having the focus. When something else
  // takes it (a shortcut that focuses an editor, another window), the
  // panel goes, and the focus stays where it went.
  input.addEventListener("blur", () => close(false));
  input.addEventListener("keydown", (event) => {
    // Enter that ends an input-method composition is not a choice.
    if (event.isComposing) return;
    // Ctrl+N / Ctrl+P move too, as in a terminal; never with the command key.
    const terminal = event.ctrlKey && !event.metaKey && !event.altKey;
    if (event.key === "ArrowDown" || (terminal && event.key === "n")) setActive(active + 1);
    else if (event.key === "ArrowUp" || (terminal && event.key === "p")) setActive(active - 1);
    else if (event.key === "Home" && shown.length) setActive(0);
    else if (event.key === "End" && shown.length) setActive(shown.length - 1);
    else if (event.key === "Enter") pick(active);
    else if (event.key === "Escape") close();
    else if (event.key === "Tab") {
      // Nothing else in the panel takes focus.
    } else return;
    event.preventDefault();
    event.stopPropagation();
  });
  list.addEventListener("mousemove", (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>(".palette__item");
    const index = row ? rows().indexOf(row) : -1;
    if (index >= 0 && index !== active) setActive(index, false);
  });
  list.addEventListener("click", (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>(".palette__item");
    if (row) pick(rows().indexOf(row));
  });
  // A press outside the panel dismisses; inside, it must not take focus from the field.
  element.addEventListener("mousedown", (event) => {
    if (event.target === element) close();
    else if (event.target !== input) event.preventDefault();
  });

  document.body.appendChild(element);
  render();
  input.focus();

  return {
    element,
    close: () => close(),
    setItems: (next) => {
      items = next;
      render(shown[active]?.item.id);
    },
    setNote,
  };
}
