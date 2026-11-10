// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

// Table-of-contents sidebar. Entries come from whichever surface is mounted
// (DOM headings, ProseMirror heading nodes, or Markdown lines); the sidebar
// only draws them and reports clicks.

import { splitFrontMatter } from "./frontmatter";
import { Sidebar } from "./sidebar";

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

/** Headings from Markdown source, skipping front matter and fenced code. Lines are 1-based. */
export function headingsFromMarkdown(text: string): Heading[] {
  const out: Heading[] = [];
  let inFence = false;
  const { matter } = splitFrontMatter(text);
  const skip = matter ? matter.raw.split("\n").length - (matter.raw.endsWith("\n") ? 1 : 0) : 0;
  text.split("\n").forEach((raw, index) => {
    if (index < skip) return;
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

export class Outline extends Sidebar {
  private readonly list: HTMLElement;
  private entries: OutlineEntry[] = [];
  private active = -1;

  /**
   * @param onResize called with the new width when the user finishes a drag
   *   on the sidebar's right edge; the caller persists it.
   */
  constructor(onResize?: (width: number) => void) {
    super({ className: "outline", label: "Outline", onResize });

    const title = document.createElement("div");
    title.className = "sidebar__title";
    title.textContent = "outline";

    this.list = document.createElement("nav");
    this.list.className = "outline__list";
    this.list.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-index]");
      if (!button) return;
      const index = Number(button.dataset["index"]);
      this.entries[index]?.go();
    });

    this.element.append(title, this.list, this.handle);
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
