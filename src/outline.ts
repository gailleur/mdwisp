// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

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

export const OUTLINE_DEFAULT_WIDTH = 232;
export const OUTLINE_MIN_WIDTH = 140;
const OUTLINE_MAX_WIDTH = 600;

/** Keeps the sidebar readable and leaves room for the document. */
export function clampOutlineWidth(width: number, viewportWidth: number): number {
  const max = Math.max(OUTLINE_MIN_WIDTH, Math.min(OUTLINE_MAX_WIDTH, Math.floor(viewportWidth * 0.6)));
  if (!Number.isFinite(width)) return OUTLINE_DEFAULT_WIDTH;
  return Math.round(Math.min(max, Math.max(OUTLINE_MIN_WIDTH, width)));
}

export class Outline {
  readonly element: HTMLElement;
  private readonly list: HTMLElement;
  private entries: OutlineEntry[] = [];
  private active = -1;
  private width = OUTLINE_DEFAULT_WIDTH;

  /**
   * @param onResize called with the new width when the user finishes a drag
   *   on the sidebar's right edge; the caller persists it.
   */
  constructor(private readonly onResize?: (width: number) => void) {
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

    const handle = document.createElement("div");
    handle.className = "outline__handle";
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-orientation", "vertical");
    handle.setAttribute("aria-label", "Resize outline");
    handle.title = "Drag to resize";
    handle.addEventListener("pointerdown", (event) => this.startDrag(event, handle));
    handle.addEventListener("dblclick", () => this.setWidth(OUTLINE_DEFAULT_WIDTH, true));

    this.element.append(title, this.list, handle);
    this.applyWidth();
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  setOpen(open: boolean): void {
    this.element.hidden = !open;
  }

  /** Sets the sidebar width in CSS pixels, clamped to what fits. */
  setWidth(width: number, notify = false): void {
    const next = clampOutlineWidth(width, window.innerWidth);
    const changed = next !== this.width;
    this.width = next;
    this.applyWidth();
    if (notify && changed) this.onResize?.(next);
  }

  private applyWidth(): void {
    this.element.style.setProperty("--outline-width", `${this.width}px`);
  }

  private startDrag(event: PointerEvent, handle: HTMLElement): void {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = this.width;
    this.element.classList.add("outline--resizing");
    document.body.classList.add("is-resizing-outline");
    handle.setPointerCapture(event.pointerId);

    const move = (e: PointerEvent) => this.setWidth(startWidth + (e.clientX - startX));
    const finish = (e: PointerEvent) => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
      this.element.classList.remove("outline--resizing");
      document.body.classList.remove("is-resizing-outline");
      if (this.width !== startWidth) this.onResize?.(this.width);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
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
