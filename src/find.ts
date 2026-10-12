// SPDX-License-Identifier: LicenseRef-Proprietary
// Copyright (c) 2026 Gailleur. All rights reserved.

// In-document search. Where the CSS Custom Highlight API exists, matches are
// painted without touching the DOM, which is what makes searching inside a
// live ProseMirror editor safe. Otherwise matches are wrapped in <mark>
// elements and unwrapped on clear (reading view only).

interface Highlighter {
  apply(ranges: Range[], active: number): void;
  clear(): void;
  readonly mutatesDom: boolean;
}

function cssHighlighter(): Highlighter | null {
  if (typeof Highlight === "undefined" || typeof CSS === "undefined" || !CSS.highlights) return null;
  const registry = CSS.highlights;
  const HighlightCtor = Highlight;
  return {
    mutatesDom: false,
    apply(ranges, active) {
      registry.set("find", new HighlightCtor(...ranges));
      const current = ranges[active];
      if (current) registry.set("find-active", new HighlightCtor(current));
      else registry.delete("find-active");
    },
    clear() {
      registry.delete("find");
      registry.delete("find-active");
    },
  };
}

function markHighlighter(): Highlighter {
  let marks: HTMLElement[] = [];
  return {
    mutatesDom: true,
    apply(ranges, active) {
      this.clear();
      ranges.forEach((range, index) => {
        const mark = document.createElement("mark");
        mark.className = index === active ? "find__match find__match--active" : "find__match";
        try {
          range.surroundContents(mark);
          marks.push(mark);
        } catch {
          // Range crosses element boundaries; skip rather than corrupt.
        }
      });
    },
    clear() {
      for (const mark of marks) {
        const parent = mark.parentNode;
        if (!parent) continue;
        parent.replaceChild(document.createTextNode(mark.textContent ?? ""), mark);
        parent.normalize();
      }
      marks = [];
    },
  };
}

export function findRanges(root: Node, query: string): Range[] {
  const needle = query.toLowerCase();
  if (!needle) return [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
      const tag = node.parentElement?.tagName;
      return tag === "SCRIPT" || tag === "STYLE" ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  const ranges: Range[] = [];
  while (walker.nextNode()) {
    const text = walker.currentNode as Text;
    const haystack = (text.nodeValue ?? "").toLowerCase();
    let index = haystack.indexOf(needle);
    while (index >= 0) {
      const range = document.createRange();
      range.setStart(text, index);
      range.setEnd(text, index + needle.length);
      ranges.push(range);
      index = haystack.indexOf(needle, index + needle.length);
    }
  }
  return ranges;
}

export class FindBar {
  readonly element: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly count: HTMLElement;
  private readonly painter: Highlighter;
  private ranges: Range[] = [];
  private active = -1;
  private query = "";
  private target: HTMLElement | null = null;
  private allowDomMutation = true;

  constructor(private readonly scroller: HTMLElement) {
    this.painter = cssHighlighter() ?? markHighlighter();

    this.element = document.createElement("section");
    this.element.className = "find";
    this.element.setAttribute("role", "search");
    this.element.hidden = true;

    this.input = document.createElement("input");
    this.input.type = "search";
    this.input.className = "find__input";
    this.input.placeholder = "Find";
    this.input.setAttribute("aria-label", "Find in document");
    this.input.spellcheck = false;

    this.count = document.createElement("span");
    this.count.className = "find__count";
    this.count.setAttribute("aria-live", "polite");

    const prev = this.button("↑", "Previous match", () => this.step(-1));
    const next = this.button("↓", "Next match", () => this.step(1));
    const close = this.button("✕", "Close", () => this.close());

    this.input.addEventListener("input", () => this.search(this.input.value));
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.step(event.shiftKey ? -1 : 1);
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.close();
      }
    });

    this.element.append(this.input, this.count, prev, next, close);
  }

  /** True when searching this target would require editing its DOM. */
  get requiresDomMutation(): boolean {
    return this.painter.mutatesDom;
  }

  /**
   * The element whose text is searched. `live` targets (editors) are only
   * searchable with a non-mutating painter.
   */
  setTarget(target: HTMLElement | null, live = false): void {
    if (target === this.target && live === !this.allowDomMutation) return;
    this.clear();
    this.target = target;
    this.allowDomMutation = !live;
    if (this.isOpen && this.query) this.search(this.query);
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  open(): void {
    this.element.hidden = false;
    this.input.focus();
    this.input.select();
    this.search(this.input.value);
  }

  close(): void {
    this.element.hidden = true;
    this.clear();
    this.query = "";
    this.input.value = "";
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** Called when the target's content was replaced. */
  refresh(): void {
    this.ranges = [];
    this.active = -1;
    if (this.isOpen && this.query) this.search(this.query, true);
    else this.updateCount();
  }

  step(direction: 1 | -1): void {
    if (!this.isOpen) {
      this.open();
      return;
    }
    if (this.ranges.length === 0) return;
    this.activate(this.active + direction);
  }

  private button(glyph: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "find__button";
    button.textContent = glyph;
    button.setAttribute("aria-label", label);
    button.addEventListener("click", onClick);
    return button;
  }

  private get searchable(): boolean {
    return this.target !== null && (this.allowDomMutation || !this.painter.mutatesDom);
  }

  private search(raw: string, keepIndex = false): void {
    const previous = this.active;
    this.clear();
    this.query = raw.trim();
    if (!this.query || !this.target) {
      this.updateCount();
      return;
    }
    if (!this.searchable) {
      this.count.textContent = "n/a";
      return;
    }
    this.ranges = findRanges(this.target, this.query);
    if (this.ranges.length === 0) {
      this.updateCount();
      return;
    }
    this.activate(keepIndex && previous >= 0 ? previous : 0);
  }

  private activate(index: number): void {
    const n = this.ranges.length;
    const next = ((index % n) + n) % n;
    this.active = next;
    this.painter.apply(this.ranges, next);
    this.updateCount();
    const range = this.ranges[next];
    if (range) scrollIntoScroller(this.scroller, range.getBoundingClientRect());
  }

  private clear(): void {
    this.painter.clear();
    this.ranges = [];
    this.active = -1;
  }

  private updateCount(): void {
    if (!this.query) this.count.textContent = "";
    else if (this.ranges.length === 0) this.count.textContent = "0";
    else this.count.textContent = `${this.active + 1}/${this.ranges.length}`;
  }
}

function scrollIntoScroller(scroller: HTMLElement, box: DOMRect): void {
  const view = scroller.getBoundingClientRect();
  if (box.top < view.top || box.bottom > view.bottom) {
    scroller.scrollTop += box.top - view.top - view.height / 2;
  }
}
