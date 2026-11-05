// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

import { beforeEach, describe, expect, it } from "vitest";

import { FindBar, findRanges } from "./find";

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
