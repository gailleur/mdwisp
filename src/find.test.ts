// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_FIND_OPTIONS,
  FindBar,
  compilePattern,
  countIn,
  findMatches,
  findRanges,
  isWholeWord,
  replacementFor,
  type FindOptions,
  type ReplaceEdit,
  type Replacer,
} from "./find";

function setup(html: string): { bar: FindBar; article: HTMLElement; input: HTMLInputElement; count: HTMLElement } {
  document.body.innerHTML = '<main id="viewer"><article></article></main>';
  const viewer = document.getElementById("viewer")!;
  const article = viewer.querySelector("article")!;
  article.innerHTML = html;
  const bar = new FindBar(viewer);
  document.body.appendChild(bar.element);
  bar.setTarget(article);
  return {
    bar,
    article,
    input: bar.element.querySelector<HTMLInputElement>(".find__input")!,
    count: bar.element.querySelector<HTMLElement>(".find__count")!,
  };
}

describe("findRanges", () => {
  it("finds every occurrence in the text, ignoring case, across elements", () => {
    const { article } = setup("<p>An Invoice and an <em>invoice</em>.</p><p>None here.</p>");
    expect(findRanges(article, "invoice").map((r) => r.toString())).toEqual(["Invoice", "invoice"]);
    expect(findRanges(article, "")).toEqual([]);
  });
});

describe("FindBar", () => {
  beforeEach(() => {
    Range.prototype.getBoundingClientRect = () => new DOMRect();
  });

  it("show() opens on a query without taking the focus and lands on the chosen match", () => {
    const { bar, input, count } = setup("<p>invoice one</p><p>invoice two</p><p>invoice three</p>");
    const before = document.createElement("button");
    document.body.appendChild(before);
    before.focus();

    bar.show("invoice", (ranges) => ranges.length - 1);
    expect(bar.isOpen).toBe(true);
    expect(input.value).toBe("invoice");
    expect(count.textContent).toBe("3/3");
    expect(document.activeElement).toBe(before);

    // From there the usual stepping carries on, wrapping round.
    bar.step(1);
    expect(count.textContent).toBe("1/3");
  });

  it("stays on the active match when the document is rendered again", () => {
    const { bar, article, count } = setup("<p>invoice one</p><p>invoice two</p><p>invoice three</p>");
    bar.show("invoice", () => 1);
    expect(count.textContent).toBe("2/3");
    article.innerHTML = "<p>invoice one</p><p>invoice two!</p><p>invoice three</p>";
    bar.refresh();
    expect(count.textContent).toBe("2/3");
    // Fewer matches than before: the last one, not a jump back to the first.
    bar.show("invoice", () => 2);
    article.innerHTML = "<p>invoice one</p><p>invoice two</p>";
    bar.refresh();
    expect(count.textContent).toBe("2/2");
  });

  it("show() starts at the first match when none is chosen, and reports no match", () => {
    const { bar, count } = setup("<p>invoice one</p><p>invoice two</p>");
    bar.show("invoice", () => -1);
    expect(count.textContent).toBe("1/2");
    bar.show("absent");
    expect(count.textContent).toBe("0");
    bar.close();
    expect(bar.isOpen).toBe(false);
  });
});

describe("compilePattern", () => {
  it("escapes a literal query and ignores case unless asked", () => {
    const literal = compilePattern("a.b (c)", DEFAULT_FIND_OPTIONS)!;
    expect(literal.test("A.B (C)")).toBe(true);
    literal.lastIndex = 0;
    expect(literal.test("axb (c)")).toBe(false);
    const cased = compilePattern("Invoice", { ...DEFAULT_FIND_OPTIONS, matchCase: true })!;
    expect(cased.test("invoice")).toBe(false);
    expect(compilePattern("", DEFAULT_FIND_OPTIONS)).toBeNull();
  });

  it("takes a regular expression as written, and throws when it is invalid", () => {
    const regex = { ...DEFAULT_FIND_OPTIONS, regex: true };
    expect(compilePattern("\\p{Lu}\\d+", regex)!.test("A12")).toBe(true);
    // Not valid in Unicode mode, still a valid expression.
    expect(compilePattern("a\\-b", regex)!.test("a-b")).toBe(true);
    expect(() => compilePattern("(unclosed", regex)).toThrow(SyntaxError);
  });
});

describe("isWholeWord", () => {
  it("rejects a match that runs into a letter, digit or underscore on either side", () => {
    expect(isWholeWord("a cat sat", 2, 5)).toBe(true);
    expect(isWholeWord("concatenate", 3, 6)).toBe(false);
    expect(isWholeWord("cats", 0, 3)).toBe(false);
    expect(isWholeWord("cat_1", 0, 3)).toBe(false);
    expect(isWholeWord("(cat)", 1, 4)).toBe(true);
    // Accented letters are letters.
    expect(isWholeWord("écat", 1, 4)).toBe(false);
    expect(isWholeWord("café au lait", 0, 4)).toBe(true);
    // Edges that are not word characters need no boundary.
    expect(isWholeWord("a-b", 1, 2)).toBe(true);
  });
});

describe("findRanges with options", () => {
  it("matches case, whole words and regular expressions", () => {
    const { article } = setup("<p>Cat, cat and concatenate.</p><p>v1.2 and v10</p>");
    const texts = (query: string, options: Partial<FindOptions>) =>
      findRanges(article, query, { ...DEFAULT_FIND_OPTIONS, ...options }).map((r) => r.toString());
    expect(texts("cat", {})).toEqual(["Cat", "cat", "cat"]);
    expect(texts("cat", { matchCase: true })).toEqual(["cat", "cat"]);
    expect(texts("cat", { wholeWord: true })).toEqual(["Cat", "cat"]);
    expect(texts("v\\d+", { regex: true })).toEqual(["v1", "v10"]);
    expect(texts("v1.2", {})).toEqual(["v1.2"]);
  });

  it("skips empty matches and returns nothing for an invalid expression", () => {
    const { article } = setup("<p>abc</p>");
    expect(findRanges(article, "x*", { ...DEFAULT_FIND_OPTIONS, regex: true })).toEqual([]);
    expect(findRanges(article, "(", { ...DEFAULT_FIND_OPTIONS, regex: true })).toEqual([]);
  });

  it("stops at the limit", () => {
    const { article } = setup(`<p>${"a ".repeat(50)}</p>`);
    const pattern = compilePattern("a", DEFAULT_FIND_OPTIONS)!;
    expect(findMatches(article, pattern, DEFAULT_FIND_OPTIONS, 10)).toHaveLength(10);
  });
});

describe("replacementFor", () => {
  it("uses a literal template as it is", () => {
    const pattern = compilePattern("cat", DEFAULT_FIND_OPTIONS)!;
    expect(replacementFor(pattern, "a cat", 2, 3, "$1 & $&", false)).toBe("$1 & $&");
  });

  it("expands captures, names and $& for a regular expression, at that one match", () => {
    const regex = { ...DEFAULT_FIND_OPTIONS, regex: true };
    const names = compilePattern("(\\w+) (?<last>\\w+)", regex)!;
    expect(replacementFor(names, "Ada Lovelace", 0, 12, "$<last>, $1 ($&) $$", true)).toBe("Lovelace, Ada (Ada Lovelace) $");
    // A lookbehind sees the text before the match.
    const behind = compilePattern("(?<=\\$)\\d+", regex)!;
    expect(replacementFor(behind, "cost $42", 6, 2, "[$&]", true)).toBe("[42]");
  });

  it("returns null when the text no longer matches there", () => {
    const pattern = compilePattern("cat", DEFAULT_FIND_OPTIONS)!;
    expect(replacementFor(pattern, "a dog", 2, 3, "x", false)).toBeNull();
    expect(replacementFor(pattern, "a cats", 2, 4, "x", false)).toBeNull();
  });
});

describe("countIn", () => {
  it("counts the matches a string holds, honouring whole word", () => {
    const pattern = compilePattern("a", DEFAULT_FIND_OPTIONS)!;
    expect(countIn("aa", pattern)).toBe(2);
    const cat = compilePattern("cat", DEFAULT_FIND_OPTIONS)!;
    expect(countIn("cats", cat, { ...DEFAULT_FIND_OPTIONS, wholeWord: true })).toBe(0);
  });
});

/** Stands in for an editor: rewrites the text nodes, last edit first. */
function domReplacer(): Replacer & { calls: number } {
  const replacer = Object.assign(
    (edits: ReplaceEdit[]) => {
      replacer.calls += 1;
      for (const { range, text } of [...edits].reverse()) {
        (range.startContainer as Text).replaceData(range.startOffset, range.endOffset - range.startOffset, text);
      }
      return edits.length;
    },
    { calls: 0 },
  );
  return replacer;
}

describe("FindBar options and replace", () => {
  // Replacing goes with the editor, which is only searched where the CSS
  // Custom Highlight API paints matches without touching the DOM.
  beforeEach(() => {
    Range.prototype.getBoundingClientRect = () => new DOMRect();
    vi.stubGlobal(
      "Highlight",
      class {
        readonly ranges: Range[];
        constructor(...ranges: Range[]) {
          this.ranges = ranges;
        }
      },
    );
    vi.stubGlobal("CSS", { highlights: new Map() });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const parts = (bar: FindBar) => ({
    replaceRow: bar.element.querySelector<HTMLElement>(".find__row--replace")!,
    replaceInput: bar.element.querySelector<HTMLInputElement>(".find__input--replace")!,
    expander: bar.element.querySelector<HTMLButtonElement>(".find__expander")!,
    toggle: (label: string) =>
      Array.from(bar.element.querySelectorAll<HTMLButtonElement>(".find__toggle")).find((b) => b.getAttribute("aria-label")?.startsWith(label))!,
  });

  const type = (input: HTMLInputElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event("input"));
  };

  it("re-searches when an option is switched, and shows its state", () => {
    const { bar, input, count } = setup("<p>Cat and cat</p>");
    const { toggle } = parts(bar);
    bar.open();
    type(input, "cat");
    expect(count.textContent).toBe("1/2");
    toggle("Match case").click();
    expect(toggle("Match case").getAttribute("aria-pressed")).toBe("true");
    expect(count.textContent).toBe("1/1");
    // The keyboard does the same from anywhere in the bar.
    input.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyC", key: "c", altKey: true, bubbles: true }));
    expect(bar.findOptions.matchCase).toBe(false);
    expect(count.textContent).toBe("1/2");
  });

  it("flags an invalid regular expression instead of searching", () => {
    const { bar, input, count } = setup("<p>text</p>");
    const { toggle } = parts(bar);
    bar.open();
    toggle("Regular expression").click();
    type(input, "(te");
    expect(count.textContent).toBe("error");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    type(input, "(te)");
    expect(count.textContent).toBe("1/1");
    expect(input.hasAttribute("aria-invalid")).toBe(false);
  });

  it("has no replace where there is no replacer", () => {
    const { bar } = setup("<p>cat</p>");
    const { replaceRow, expander } = parts(bar);
    expect(bar.openReplace()).toBe(false);
    expect(bar.isOpen).toBe(false);
    bar.setReplacer(domReplacer());
    expect(expander.hidden).toBe(false);
    expect(bar.openReplace()).toBe(true);
    expect(replaceRow.hidden).toBe(false);
    bar.setReplacer(null);
    expect(expander.hidden).toBe(true);
    expect(replaceRow.hidden).toBe(true);
  });

  it("replaces the current match and moves on, wrapping round", () => {
    const { bar, article, input, count } = setup("<p>cat one, cat two, cat three</p>");
    const replacer = domReplacer();
    bar.setReplacer(replacer);
    const { replaceInput } = parts(bar);
    bar.openReplace();
    type(input, "cat");
    bar.step(1);
    expect(count.textContent).toBe("2/3");
    replaceInput.value = "dog";
    replaceInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(article.textContent).toBe("cat one, dog two, cat three");
    expect(count.textContent).toBe("2/2");
    bar.replaceCurrent();
    expect(article.textContent).toBe("cat one, dog two, dog three");
    // Past the last match: back to the first.
    expect(count.textContent).toBe("1/1");
  });

  it("steps over matches the replacement itself contains", () => {
    const { bar, article, input, count } = setup("<p>a b a</p>");
    bar.setReplacer(domReplacer());
    const { replaceInput } = parts(bar);
    bar.openReplace();
    type(input, "a");
    replaceInput.value = "aa";
    bar.replaceCurrent();
    expect(article.textContent).toBe("aa b a");
    expect(count.textContent).toBe("3/3");
  });

  it("replaces all matches in one call and reports how many", () => {
    const notices: string[] = [];
    document.body.innerHTML = '<main id="viewer"><article><p>cat, cat</p><p>cat</p></article></main>';
    const viewer = document.getElementById("viewer")!;
    const article = viewer.querySelector("article")!;
    const bar = new FindBar(viewer, { notify: (message) => notices.push(message) });
    document.body.appendChild(bar.element);
    bar.setTarget(article, true);
    const replacer = domReplacer();
    bar.setReplacer(replacer);
    const input = bar.element.querySelector<HTMLInputElement>(".find__input")!;
    const { replaceInput } = parts(bar);
    bar.openReplace();
    type(input, "cat");
    replaceInput.value = "dog";
    replaceInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    expect(article.textContent).toBe("dog, dogdog");
    expect(replacer.calls).toBe(1);
    expect(notices).toEqual(["3 replaced"]);
    expect(bar.element.querySelector(".find__count")!.textContent).toBe("0");
  });

  it("expands captures with a regular expression", () => {
    const { bar, article, input } = setup("<p>Lovelace Ada</p>");
    bar.setReplacer(domReplacer());
    const { replaceInput, toggle } = parts(bar);
    bar.openReplace();
    toggle("Regular expression").click();
    type(input, "(\\w+) (\\w+)");
    replaceInput.value = "$2 $1";
    bar.replaceEvery();
    expect(article.textContent).toBe("Ada Lovelace");
  });

  it("does not replace text that changed since it was found", () => {
    const { bar, article, input } = setup("<p>cat</p>");
    const replacer = domReplacer();
    bar.setReplacer(replacer);
    bar.openReplace();
    type(input, "cat");
    (article.querySelector("p")!.firstChild as Text).data = "cow";
    bar.replaceCurrent();
    expect(replacer.calls).toBe(0);
    expect(article.textContent).toBe("cow");
  });

  it("show() goes back to a literal, case-blind search, as find in folder is", () => {
    const { bar, count } = setup("<p>Invoice a+b</p>");
    const { toggle } = parts(bar);
    bar.open();
    toggle("Match case").click();
    toggle("Regular expression").click();
    bar.show("a+b");
    expect(count.textContent).toBe("1/1");
    expect(toggle("Regular expression").getAttribute("aria-pressed")).toBe("false");
    expect(toggle("Match case").getAttribute("aria-pressed")).toBe("false");
  });

  it("closes on Escape from the replace field, folding the replace row", () => {
    const { bar } = setup("<p>cat</p>");
    bar.setReplacer(domReplacer());
    const { replaceInput, replaceRow } = parts(bar);
    bar.openReplace();
    replaceInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(bar.isOpen).toBe(false);
    expect(replaceRow.hidden).toBe(true);
  });
});
