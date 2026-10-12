// SPDX-License-Identifier: LicenseRef-Proprietary
// Copyright (c) 2026 Gailleur Labs. All rights reserved.

// Table-of-contents sidebar. Entries come from whichever surface is mounted
// (DOM headings, ProseMirror heading nodes, or Markdown lines); the sidebar
// only draws them and reports clicks.

export interface OutlineEntry {
  level: number;
  text: string;
  /** Scrolls to / selects the heading in the active surface. */
  go: () => void;
}

export interface Heading {
  level: number;
  text: string;
  line: number;
}

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.+?)\s*#*\s*$/;

/** Headings from Markdown source, skipping fenced code. Lines are 1-based. */
export function headingsFromMarkdown(text: string): Heading[] {
  const out: Heading[] = [];
  let inFence = false;
  text.split("\n").forEach((raw, index) => {
    if (FENCE.test(raw)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const match = HEADING.exec(raw);
    if (match?.[1] && match[2]) out.push({ level: match[1].length, text: match[2].trim(), line: index + 1 });
  });
  return out;
}

export class Outline {
  readonly element: HTMLElement;
  private readonly list: HTMLElement;
  private entries: OutlineEntry[] = [];
  private active = -1;

  constructor() {
    this.element = document.createElement("aside");
    this.element.className = "outline";
    this.element.setAttribute("aria-label", "Outline");
    this.element.hidden = true;

    const title = document.createElement("div");
    title.className = "outline__title";
    title.textContent = "outline";

    this.list = document.createElement("nav");
    this.list.className = "outline__list";
    this.list.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-index]");
      if (!button) return;
      const index = Number(button.dataset["index"]);
      this.entries[index]?.go();
    });

    this.element.append(title, this.list);
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  setOpen(open: boolean): void {
    this.element.hidden = !open;
  }

  setEntries(entries: OutlineEntry[]): void {
    this.entries = entries;
    this.active = -1;
    this.list.replaceChildren();
    if (entries.length === 0) {
      const empty = document.createElement("p");
      empty.className = "outline__empty";
      empty.textContent = "no headings";
      this.list.appendChild(empty);
      return;
    }
    const minLevel = Math.min(...entries.map((e) => e.level));
    entries.forEach((entry, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "outline__item";
      button.dataset["index"] = String(index);
      button.style.setProperty("--depth", String(entry.level - minLevel));
      button.textContent = entry.text;
      button.title = entry.text;
      this.list.appendChild(button);
    });
  }

  setActive(index: number): void {
    if (index === this.active) return;
    const items = this.list.querySelectorAll<HTMLElement>(".outline__item");
    items[this.active]?.classList.remove("outline__item--active");
    const next = items[index];
    if (next) {
      next.classList.add("outline__item--active");
      next.scrollIntoView({ block: "nearest" });
    }
    this.active = index;
  }
}
