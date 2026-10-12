// SPDX-License-Identifier: LicenseRef-Proprietary
// Copyright (c) 2026 Gailleur. All rights reserved.

// In-document search. Matches are wrapped in <mark> elements and unwrapped
// again on clear, so the rendered DOM is restored exactly.

export class FindBar {
  readonly element: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly count: HTMLElement;
  private marks: HTMLElement[] = [];
  private active = -1;
  private query = "";
  private target: HTMLElement | null = null;

  constructor(private readonly scroller: HTMLElement) {
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

  /** The element whose text is searched. Changing it clears the search. */
  setTarget(target: HTMLElement | null): void {
    if (target === this.target) return;
    this.clear();
    this.target = target;
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

  /** Called by the owner when the target was re-rendered. */
  refresh(): void {
    this.marks = [];
    this.active = -1;
    if (this.isOpen && this.query) this.search(this.query, true);
    else this.updateCount();
  }

  step(direction: 1 | -1): void {
    if (!this.isOpen) {
      this.open();
      return;
    }
    if (this.marks.length === 0) return;
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

  private search(raw: string, keepIndex = false): void {
    const previous = this.active;
    this.clear();
    this.query = raw.trim();
    if (!this.query || !this.target) {
      this.updateCount();
      return;
    }
    this.marks = highlight(this.target, this.query);
    if (this.marks.length === 0) {
      this.updateCount();
      return;
    }
    this.activate(keepIndex && previous >= 0 ? previous : 0);
  }

  private activate(index: number): void {
    const n = this.marks.length;
    const next = ((index % n) + n) % n;
    this.marks[this.active]?.classList.remove("find__match--active");
    const mark = this.marks[next];
    if (!mark) return;
    mark.classList.add("find__match--active");
    this.active = next;
    this.updateCount();
    scrollIntoScroller(this.scroller, mark);
  }

  private clear(): void {
    for (const mark of this.marks) {
      const parent = mark.parentNode;
      if (!parent) continue;
      parent.replaceChild(document.createTextNode(mark.textContent ?? ""), mark);
      parent.normalize();
    }
    this.marks = [];
    this.active = -1;
  }

  private updateCount(): void {
    if (!this.query) this.count.textContent = "";
    else if (this.marks.length === 0) this.count.textContent = "0";
    else this.count.textContent = `${this.active + 1}/${this.marks.length}`;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function highlight(root: HTMLElement, query: string): HTMLElement[] {
  const pattern = new RegExp(escapeRegExp(query), "gi");
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
      const tag = node.parentElement?.tagName;
      return tag === "SCRIPT" || tag === "STYLE" ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);

  const marks: HTMLElement[] = [];
  for (const node of nodes) {
    const text = node.nodeValue ?? "";
    pattern.lastIndex = 0;
    let match = pattern.exec(text);
    if (!match) continue;

    const fragment = document.createDocumentFragment();
    let last = 0;
    while (match) {
      const start = match.index;
      const end = start + match[0].length;
      if (end === start) break;
      if (start > last) fragment.appendChild(document.createTextNode(text.slice(last, start)));
      const mark = document.createElement("mark");
      mark.className = "find__match";
      mark.textContent = text.slice(start, end);
      fragment.appendChild(mark);
      marks.push(mark);
      last = end;
      match = pattern.exec(text);
    }
    if (last < text.length) fragment.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode?.replaceChild(fragment, node);
  }
  return marks;
}

function scrollIntoScroller(scroller: HTMLElement, el: HTMLElement): void {
  const box = el.getBoundingClientRect();
  const view = scroller.getBoundingClientRect();
  if (box.top < view.top || box.bottom > view.bottom) {
    scroller.scrollTop += box.top - view.top - view.height / 2;
  }
}
