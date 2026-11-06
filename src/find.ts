// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

// In-document search. Where the CSS Custom Highlight API exists, matches are
// painted without touching the DOM, which is what makes searching inside a
// live ProseMirror editor safe. Otherwise matches are wrapped in <mark>
// elements and unwrapped on clear (reading view only).
//
// The bar can also replace. It never edits the DOM for that: it hands the
// matches to a replacer supplied by the active editor, which turns them
// into one undoable editor transaction. The reading view has no replacer,
// so it only finds.

import { keysFor } from "./help";

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

export interface FindOptions {
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export const DEFAULT_FIND_OPTIONS: Readonly<FindOptions> = { matchCase: false, wholeWord: false, regex: false };

/** More matches than this are not highlighted or counted; the count shows "+". */
export const MAX_MATCHES = 10_000;

/** One change for a replacer: the text of `range` becomes `text`. */
export interface ReplaceEdit {
  range: Range;
  text: string;
}

/**
 * Applies edits to the document behind the searched DOM, as one undoable
 * step, and returns how many it applied. Edits it cannot map back to the
 * document (stale, or in a part the user cannot edit) are skipped.
 */
export type Replacer = (edits: ReplaceEdit[]) => number;

const SYNTAX = /[\\^$.*+?()[\]{}|/]/g;
const WORD_CHAR = /[\p{L}\p{N}\p{M}_]/u;

/**
 * The pattern for `query`, or null for an empty query. A literal query is
 * escaped; a regular expression is taken as written, in Unicode mode when it
 * allows it. Throws a SyntaxError for an invalid regular expression.
 */
export function compilePattern(query: string, options: FindOptions = DEFAULT_FIND_OPTIONS): RegExp | null {
  if (!query) return null;
  const flags = options.matchCase ? "g" : "gi";
  if (!options.regex) return new RegExp(query.replace(SYNTAX, "\\$&"), `${flags}u`);
  try {
    return new RegExp(query, `${flags}u`);
  } catch {
    // Unicode mode is stricter (\- outside a class, for one); fall back.
    return new RegExp(query, flags);
  }
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD_CHAR.test(ch);
}

/** Last code point of `text` before `at`, if any. */
function charBefore(text: string, at: number): string | undefined {
  return Array.from(text.slice(Math.max(0, at - 2), at)).pop();
}

/** Code point of `text` at `at`, if any. */
function charAt(text: string, at: number): string | undefined {
  const code = text.codePointAt(at);
  return code === undefined ? undefined : String.fromCodePoint(code);
}

/**
 * True when the match [start, end) of `text` does not run into a word on
 * either side: an edge that is a letter, digit or underscore must not be
 * preceded (or followed) by another one.
 */
export function isWholeWord(text: string, start: number, end: number): boolean {
  if (isWordChar(charAt(text, start)) && isWordChar(charBefore(text, start))) return false;
  if (isWordChar(charBefore(text, end)) && isWordChar(charAt(text, end))) return false;
  return true;
}

/**
 * Matches of `pattern` in the text under `root`. Matches stay within one run
 * of text (a text node), and empty matches are skipped, since there is
 * nothing to show or replace.
 */
export function findMatches(root: Node, pattern: RegExp, options: FindOptions = DEFAULT_FIND_OPTIONS, limit = MAX_MATCHES): Range[] {
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
    const haystack = text.data;
    pattern.lastIndex = 0;
    for (let match = pattern.exec(haystack); match !== null; match = pattern.exec(haystack)) {
      const start = match.index;
      const end = start + match[0].length;
      if (end === start) {
        pattern.lastIndex = start + (charAt(haystack, start)?.length ?? 1);
        continue;
      }
      if (options.wholeWord && !isWholeWord(haystack, start, end)) continue;
      const range = document.createRange();
      range.setStart(text, start);
      range.setEnd(text, end);
      ranges.push(range);
      if (ranges.length >= limit) return ranges;
    }
  }
  return ranges;
}

/** Ranges of `query` under `root`; none for an empty or invalid query. */
export function findRanges(root: Node, query: string, options: FindOptions = DEFAULT_FIND_OPTIONS): Range[] {
  let pattern: RegExp | null;
  try {
    pattern = compilePattern(query, options);
  } catch {
    return [];
  }
  return pattern ? findMatches(root, pattern, options) : [];
}

/**
 * The text that replaces the match of `pattern` at [index, index + length)
 * of `input`, or null when the pattern no longer matches exactly there
 * (the text changed since it was searched). With `expand`, `$1`, `$<name>`,
 * `$&` and `$$` in the template are expanded the way String.replace does,
 * evaluated at that one match so lookarounds see their real context;
 * without it the template is used as it is.
 */
export function replacementFor(pattern: RegExp, input: string, index: number, length: number, template: string, expand: boolean): string | null {
  const sticky = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}y`);
  sticky.lastIndex = index;
  const match = sticky.exec(input);
  if (!match || match.index !== index || match[0].length !== length) return null;
  if (!expand) return template;
  sticky.lastIndex = index;
  const out = input.replace(sticky, template);
  return out.slice(index, out.length - (input.length - index - length));
}

/** How many matches of `pattern` the string `text` holds by itself. */
export function countIn(text: string, pattern: RegExp, options: FindOptions = DEFAULT_FIND_OPTIONS): number {
  pattern.lastIndex = 0;
  let n = 0;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    const start = match.index;
    const end = start + match[0].length;
    if (end === start) pattern.lastIndex = start + (charAt(text, start)?.length ?? 1);
    else if (!options.wholeWord || isWholeWord(text, start, end)) n += 1;
  }
  return n;
}

export interface FindBarOptions {
  /** Reports what a replace did ("3 replaced"); the app shows it as a toast. */
  notify?: (message: string) => void;
}

type ToggleKey = keyof FindOptions;

export class FindBar {
  readonly element: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly count: HTMLElement;
  private readonly expander: HTMLButtonElement;
  private readonly replaceRow: HTMLElement;
  private readonly replaceInput: HTMLInputElement;
  private readonly toggles = new Map<ToggleKey, HTMLButtonElement>();
  private readonly painter: Highlighter;
  private readonly notify: (message: string) => void;
  private readonly options: FindOptions = { ...DEFAULT_FIND_OPTIONS };
  private pattern: RegExp | null = null;
  private ranges: Range[] = [];
  private active = -1;
  private capped = false;
  private invalid = false;
  private query = "";
  private target: HTMLElement | null = null;
  private allowDomMutation = true;
  private replacer: Replacer | null = null;
  private replaceOpen = false;

  constructor(private readonly scroller: HTMLElement, options: FindBarOptions = {}) {
    this.painter = cssHighlighter() ?? markHighlighter();
    const isMac = /Mac/i.test(navigator.platform);
    const keys = (glyphs: string) => keysFor(glyphs, isMac);
    const optionKeys = (letter: string) => (isMac ? `⌘⌥${letter}` : `Alt+${letter}`);
    this.notify = options.notify ?? (() => undefined);

    this.element = document.createElement("section");
    this.element.className = "find";
    this.element.setAttribute("role", "search");
    this.element.hidden = true;

    this.input = this.field("find__input", "Find", "Find in document");

    this.count = document.createElement("span");
    this.count.className = "find__count";
    this.count.setAttribute("aria-live", "polite");

    this.expander = this.button("▸", "Show replace", () => this.setReplaceOpen(!this.replaceOpen, true));
    this.expander.classList.add("find__expander");
    this.expander.setAttribute("aria-expanded", "false");
    this.expander.hidden = true;

    const toggle = (key: ToggleKey, glyph: string, label: string) => {
      const button = this.button(glyph, label, () => this.toggleOption(key));
      button.classList.add("find__toggle");
      button.setAttribute("aria-pressed", "false");
      this.toggles.set(key, button);
      return button;
    };
    const matchCase = toggle("matchCase", "Aa", `Match case (${optionKeys("C")})`);
    const wholeWord = toggle("wholeWord", "ab", `Whole word (${optionKeys("W")})`);
    wholeWord.classList.add("find__toggle--word");
    const regex = toggle("regex", ".*", `Regular expression (${optionKeys("R")})`);

    const prev = this.button("↑", "Previous match", () => this.step(-1));
    const next = this.button("↓", "Next match", () => this.step(1));
    const close = this.button("✕", "Close", () => this.close());

    this.input.addEventListener("input", () => this.search(this.input.value));
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.step(event.shiftKey ? -1 : 1);
      }
    });

    const findRow = document.createElement("div");
    findRow.className = "find__row";
    findRow.append(this.expander, this.input, matchCase, wholeWord, regex, this.count, prev, next, close);

    this.replaceInput = this.field("find__input find__input--replace", "Replace", "Replace with");
    const replaceOne = this.textButton("replace", "Replace this match (Enter)", () => this.replaceCurrent());
    const replaceAll = this.textButton("all", `Replace all matches (${keys("⌘Enter")})`, () => this.replaceEvery());
    this.replaceInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      if (event.metaKey || event.ctrlKey) this.replaceEvery();
      else this.replaceCurrent();
    });

    this.replaceRow = document.createElement("div");
    this.replaceRow.className = "find__row find__row--replace";
    this.replaceRow.hidden = true;
    this.replaceRow.append(this.replaceInput, replaceOne, replaceAll);

    // Keys that apply anywhere in the bar: Escape closes it, and the option
    // keys flip the options: Alt+C/W/R, or ⌘⌥C/W/R on a Mac, where Option
    // alone types characters (⌥C is ç). Keys are read by position, since
    // with Option held a Mac reports a symbol; Ctrl+Alt is AltGr on Windows.
    this.element.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.close();
        return;
      }
      if (!event.altKey || event.ctrlKey || event.metaKey !== isMac) return;
      const key: ToggleKey | null =
        event.code === "KeyC" ? "matchCase" : event.code === "KeyW" ? "wholeWord" : event.code === "KeyR" ? "regex" : null;
      if (!key) return;
      event.preventDefault();
      this.toggleOption(key);
    });

    this.element.append(findRow, this.replaceRow);
  }

  /** True when searching this target would require editing its DOM. */
  get requiresDomMutation(): boolean {
    return this.painter.mutatesDom;
  }

  /** The search options as they stand (match case, whole word, regex). */
  get findOptions(): Readonly<FindOptions> {
    return this.options;
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

  /**
   * What applies replacements to the searched document, or null where the
   * document cannot be edited (the reading view). Without one the bar only
   * finds, and its replace row is hidden.
   */
  setReplacer(replacer: Replacer | null): void {
    this.replacer = replacer;
    this.expander.hidden = replacer === null;
    if (!replacer) this.setReplaceOpen(false, false);
  }

  /** True when the bar can replace in the current document. */
  get canReplace(): boolean {
    return this.replacer !== null && this.searchable;
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

  /**
   * Opens the bar with its replace row. The focus goes to the replace field
   * when there is something to find already, else to the find field.
   * Returns false, and does nothing, where the document cannot be edited.
   */
  openReplace(): boolean {
    if (!this.replacer) return false;
    const wasOpen = this.isOpen;
    this.element.hidden = false;
    this.setReplaceOpen(true, false);
    if (!wasOpen) this.search(this.input.value);
    if (this.input.value.trim()) {
      this.replaceInput.focus();
      this.replaceInput.select();
    } else {
      this.input.focus();
    }
    return true;
  }

  close(): void {
    this.element.hidden = true;
    this.clear();
    this.query = "";
    this.input.value = "";
    this.setReplaceOpen(false, false);
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  /**
   * Opens the bar on `query` without taking the focus, and lands on the
   * match `choose` picks among all of them (the first if it picks none).
   * This is how a result of find-in-folder is shown in its document, so the
   * options go back to that search's own: literal, ignoring case.
   */
  show(query: string, choose?: (ranges: Range[]) => number): void {
    this.element.hidden = false;
    for (const key of Object.keys(DEFAULT_FIND_OPTIONS) as ToggleKey[]) this.setOption(key, DEFAULT_FIND_OPTIONS[key]);
    this.input.value = query;
    this.search(query, -1, choose);
  }

  /** Called when the target's content was replaced. */
  refresh(): void {
    const previous = this.active;
    this.ranges = [];
    this.active = -1;
    if (this.isOpen && this.query) this.search(this.query, previous);
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

  /**
   * Replaces the active match and moves to the next one. Matches the new
   * text itself contains are stepped over, so replacing "a" with "aa" does
   * not keep landing on what it just wrote.
   */
  replaceCurrent(): void {
    if (!this.replacer || !this.pattern || this.active < 0) return;
    const range = this.ranges[this.active];
    if (!range) return;
    const edit = this.editFor(range);
    if (!edit) {
      this.refresh();
      return;
    }
    const at = this.active;
    const applied = this.replacer([edit]);
    const skip = applied > 0 ? countIn(edit.text, this.pattern, this.options) : 0;
    // The match after the replaced one now sits at its index; past the
    // last match, wrap round to the first.
    this.search(this.query, -1, (ranges) => (at + skip) % ranges.length);
  }

  /** Replaces every match, as one undoable change. */
  replaceEvery(): void {
    if (!this.replacer || !this.pattern || this.ranges.length === 0) return;
    const edits = this.ranges.flatMap((range) => this.editFor(range) ?? []);
    const applied = edits.length > 0 ? this.replacer(edits) : 0;
    this.notify(applied === 1 ? "1 replaced" : `${applied} replaced`);
    this.search(this.query);
  }

  private editFor(range: Range): ReplaceEdit | null {
    const node = range.startContainer;
    if (!this.pattern || node !== range.endContainer || node.nodeType !== Node.TEXT_NODE) return null;
    const text = replacementFor(
      this.pattern,
      (node as Text).data,
      range.startOffset,
      range.endOffset - range.startOffset,
      this.replaceInput.value,
      this.options.regex,
    );
    return text === null ? null : { range, text };
  }

  private setReplaceOpen(open: boolean, focus: boolean): void {
    this.replaceOpen = open && this.replacer !== null;
    this.replaceRow.hidden = !this.replaceOpen;
    this.expander.textContent = this.replaceOpen ? "▾" : "▸";
    this.expander.setAttribute("aria-expanded", String(this.replaceOpen));
    this.expander.setAttribute("aria-label", this.replaceOpen ? "Hide replace" : "Show replace");
    if (focus) (this.replaceOpen ? this.replaceInput : this.input).focus();
  }

  private toggleOption(key: ToggleKey): void {
    this.setOption(key, !this.options[key]);
    if (this.isOpen) this.search(this.input.value);
  }

  private setOption(key: ToggleKey, on: boolean): void {
    this.options[key] = on;
    this.toggles.get(key)?.setAttribute("aria-pressed", String(on));
  }

  private field(className: string, placeholder: string, label: string): HTMLInputElement {
    const input = document.createElement("input");
    input.type = "search";
    input.className = className;
    input.placeholder = placeholder;
    input.setAttribute("aria-label", label);
    input.spellcheck = false;
    return input;
  }

  private button(glyph: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "find__button";
    button.textContent = glyph;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.addEventListener("click", onClick);
    return button;
  }

  private textButton(text: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = this.button(text, label, onClick);
    button.classList.add("find__button--text");
    return button;
  }

  private get searchable(): boolean {
    return this.target !== null && (this.allowDomMutation || !this.painter.mutatesDom);
  }

  /**
   * Finds `raw` in the target. The match made active is the one `choose`
   * picks, else the one at index `keep` (the match that was active before
   * the content was replaced), else the first.
   */
  private search(raw: string, keep = -1, choose?: (ranges: Range[]) => number): void {
    this.clear();
    this.query = raw.trim();
    this.setInvalid(null);
    try {
      this.pattern = compilePattern(this.query, this.options);
    } catch (error) {
      this.pattern = null;
      this.setInvalid(error instanceof Error ? error.message : String(error));
      return;
    }
    if (!this.pattern || !this.target) {
      this.updateCount();
      return;
    }
    if (!this.searchable) {
      this.count.textContent = "n/a";
      return;
    }
    this.ranges = findMatches(this.target, this.pattern, this.options);
    this.capped = this.ranges.length >= MAX_MATCHES;
    if (this.ranges.length === 0) {
      this.updateCount();
      return;
    }
    const chosen = choose ? choose(this.ranges) : -1;
    this.activate(chosen >= 0 ? chosen : keep >= 0 ? Math.min(keep, this.ranges.length - 1) : 0);
  }

  private setInvalid(message: string | null): void {
    this.invalid = message !== null;
    this.input.classList.toggle("find__input--invalid", this.invalid);
    if (this.invalid) {
      this.input.setAttribute("aria-invalid", "true");
      this.input.title = message ?? "";
      this.count.textContent = "error";
    } else {
      this.input.removeAttribute("aria-invalid");
      this.input.removeAttribute("title");
    }
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
    this.capped = false;
  }

  private updateCount(): void {
    if (this.invalid) return;
    const more = this.capped ? "+" : "";
    if (!this.query) this.count.textContent = "";
    else if (this.ranges.length === 0) this.count.textContent = "0";
    else this.count.textContent = `${this.active + 1}/${this.ranges.length}${more}`;
  }
}

function scrollIntoScroller(scroller: HTMLElement, box: DOMRect): void {
  const view = scroller.getBoundingClientRect();
  if (box.top < view.top || box.bottom > view.bottom) {
    scroller.scrollTop += box.top - view.top - view.height / 2;
  }
}
