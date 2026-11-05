// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

import { describe, expect, it } from "vitest";

import { findRanges } from "./find";
import { plainText, rangeForLine } from "./locate";

function article(html: string): HTMLElement {
  const el = document.createElement("article");
  el.innerHTML = html;
  document.body.replaceChildren(el);
  return el;
}

const blockOf = (range: Range) => range.startContainer.parentElement?.closest("p, li, h2, td, pre")?.textContent;

describe("plainText", () => {
  it("reduces a source line to the words a reader sees", () => {
    expect(plainText("## The **Invoice** _for_ March")).toBe("the invoice for march");
    expect(plainText("  - [x] pay the `invoice` ~~today~~")).toBe("pay the invoice today");
    expect(plainText("3. see [the invoice](files/invoice.pdf) and ![scan](scan.png)")).toBe("see the invoice and scan");
    expect(plainText("> > quoted <b>invoice</b>")).toBe("quoted invoice");
    expect(plainText("| invoice | 120 |")).toBe("invoice 120");
    expect(plainText("…cut invoice window…")).toBe("cut invoice window");
  });
});

describe("rangeForLine", () => {
  const root = article(
    "<h2>Invoice list</h2>" +
      "<p>The first invoice was sent\nin March.</p>" +
      "<ul><li>pay the <code>invoice</code> today</li><li>file it</li></ul>" +
      "<p>See <a href='x'>the invoice</a> again.</p>" +
      "<pre><code>total = invoice * 2</code></pre>",
  );
  const ranges = findRanges(root, "invoice");

  it("finds the rendered block that came from the line", () => {
    expect(ranges.length).toBe(5);
    expect(blockOf(ranges[rangeForLine(ranges, "## Invoice list", 1, 12)]!)).toBe("Invoice list");
    expect(blockOf(ranges[rangeForLine(ranges, "- pay the `invoice` today", 6, 12)]!)).toBe("pay the invoice today");
    expect(blockOf(ranges[rangeForLine(ranges, "See [the invoice](x) again.", 9, 12)]!)).toBe("See the invoice again.");
    expect(blockOf(ranges[rangeForLine(ranges, "total = invoice * 2", 11, 12)]!)).toBe("total = invoice * 2");
  });

  it("recognises one line of a paragraph written over several", () => {
    expect(rangeForLine(ranges, "The first invoice was sent", 3, 12)).toBe(1);
  });

  it("falls back to the occurrence at the same depth in the document", () => {
    expect(rangeForLine(ranges, "<!-- invoice: hidden -->", 1, 12)).toBe(0);
    expect(rangeForLine(ranges, "<!-- invoice: hidden -->", 12, 12)).toBe(4);
    expect(rangeForLine(ranges, "", 6, 11)).toBe(2);
    expect(rangeForLine([], "anything", 1, 1)).toBe(-1);
  });
});
