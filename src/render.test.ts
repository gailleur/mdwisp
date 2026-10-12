// SPDX-License-Identifier: LicenseRef-Proprietary
// Copyright (c) 2026 Gailleur. All rights reserved.

import { describe, expect, it } from "vitest";

import { isExternalHref, isMarkdownHref, markdownToHtml, renderDocument, resolveRelative } from "./render";

const ctx = {
  dir: "/docs",
  allowRemoteImages: true,
  assetUrl: (p: string) => `asset://localhost${p}`,
  theme: () => "light" as const,
};

describe("markdownToHtml", () => {
  it("renders GFM tables, strikethrough and task lists", async () => {
    const html = await markdownToHtml("| a | b |\n|---|---|\n| 1 | 2 |\n\n~~gone~~\n\n- [x] done\n- [ ] todo");
    expect(html).toContain("<table>");
    expect(html).toContain("<del>gone</del>");
    expect(html).toContain('type="checkbox"');
  });

  it("passes raw HTML through for the sanitiser", async () => {
    const html = await markdownToHtml('<details><summary>s</summary>body</details>\n\n<script>x</script>');
    expect(html).toContain("<details>");
    expect(html).toContain("<script>");
  });
});

describe("resolveRelative", () => {
  it("joins relative references to the document directory", () => {
    expect(resolveRelative("/docs", "img/a.png")).toBe("/docs/img/a.png");
    expect(resolveRelative("/docs/", "a%20b.png#x")).toBe("/docs/a b.png");
    expect(resolveRelative("C:\\docs", "img/a.png")).toBe("C:\\docs\\img\\a.png");
  });

  it("returns null for absolute, external and anchor references", () => {
    expect(resolveRelative("/docs", "https://x/a.png")).toBeNull();
    expect(resolveRelative("/docs", "data:image/png;base64,AA")).toBeNull();
    expect(resolveRelative("/docs", "/abs.png")).toBeNull();
    expect(resolveRelative("/docs", "#top")).toBeNull();
  });
});

describe("href classification", () => {
  it("distinguishes external and markdown links", () => {
    expect(isExternalHref("https://a")).toBe(true);
    expect(isExternalHref("mailto:a@b")).toBe(true);
    expect(isExternalHref("other.md")).toBe(false);
    expect(isMarkdownHref("other.md#sec")).toBe(true);
    expect(isMarkdownHref("a.png")).toBe(false);
  });
});

describe("renderDocument", () => {
  it("renders, sanitises, resolves images and extracts the title", async () => {
    const container = document.createElement("div");
    const result = await renderDocument(
      container,
      '# Title\n\nText <b onclick="x">bold</b>\n\n![](pic.png)\n\n```js\ncode\n```\n',
      ctx,
    );
    expect(result.title).toBe("Title");
    expect(container.querySelector("b")?.getAttribute("onclick")).toBeNull();
    expect(container.querySelector("img")?.getAttribute("src")).toBe("asset://localhost/docs/pic.png");
    expect(container.querySelector("pre button.code__copy")).not.toBeNull();
  });

  it("renders inline and display math", async () => {
    const container = document.createElement("div");
    await renderDocument(container, "Euler: $e^{i\\pi}+1=0$\n\n$$\\int_0^1 x\\,dx$$\n", ctx);
    expect(container.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector(".katex-display")).not.toBeNull();
  });

  it("turns mermaid blocks into diagram figures", async () => {
    const container = document.createElement("div");
    await renderDocument(container, "```mermaid\ngraph TD; A-->B;\n```\n", ctx);
    const figure = container.querySelector("figure.diagram");
    expect(figure).not.toBeNull();
    expect(figure?.getAttribute("data-source")).toContain("A-->B");
  });

  it("uses the file name when there is no h1", async () => {
    const container = document.createElement("div");
    const result = await renderDocument(container, "just text", ctx);
    expect(result.title).toBeNull();
  });
});
