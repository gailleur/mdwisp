// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

import { describe, expect, it } from "vitest";

import { diagramReferencesRemote, isExternalHref, isMarkdownHref, markdownToHtml, renderDocument, resolveRelative } from "./render";

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

  it("gives headings stable ids for anchors and the outline", async () => {
    const html = await markdownToHtml("# Hello World\n\n## Code & Data");
    expect(html).toContain('<h1 id="hello-world">');
    expect(html).toContain('<h2 id="code--data">');
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
    expect(container.querySelector("code.language-math")).toBeNull();
    expect(container.querySelector("button.code__copy")).toBeNull();
  });

  it("keeps Markdown syntax inside display math inert", async () => {
    const container = document.createElement("div");
    // A lone "=" line would otherwise turn the line above into a heading.
    await renderDocument(container, "$$\n\\begin{pmatrix} a \\\\ b \\end{pmatrix}\n=\nx\n$$\n", ctx);
    expect(container.querySelector("h1, h2")).toBeNull();
    expect(container.querySelector(".katex-display")).not.toBeNull();
  });

  it("treats $$ on one line as display math", async () => {
    const container = document.createElement("div");
    await renderDocument(container, "Before.\n\n$$a^2 + b^2 = c^2$$\n\nAfter.\n", ctx);
    expect(container.querySelector(".katex-display")).not.toBeNull();
    expect(container.querySelector(".math--display")).not.toBeNull();
  });

  it("renders ```math fences as display math and leaves prices alone", async () => {
    const container = document.createElement("div");
    await renderDocument(container, "```math\nx^2\n```\n\nCosts $5 or $10, not maths.\n", ctx);
    expect(container.querySelector(".katex-display")).not.toBeNull();
    expect(container.querySelectorAll(".katex").length).toBe(1);
    expect(container.textContent).toContain("$5 or $10");
  });

  it("turns mermaid blocks into diagram figures", async () => {
    const container = document.createElement("div");
    await renderDocument(container, "```mermaid\ngraph TD; A-->B;\n```\n", ctx);
    const figure = container.querySelector("figure.diagram");
    expect(figure).not.toBeNull();
    expect(figure?.getAttribute("data-source")).toContain("A-->B");
  });

  it("holds back a diagram that could fetch until remote images are allowed", async () => {
    const source = "```mermaid\nflowchart TD\n  A@{ img: \"https://t/x.png\", label: \"x\" }\n  A --> B\n```\n";
    const container = document.createElement("div");
    const blocked = await renderDocument(container, source, { ...ctx, allowRemoteImages: false });
    expect(blocked.remoteBlocked).toBe(1);
    const figure = container.querySelector("figure.diagram");
    expect(figure?.classList.contains("diagram--error")).toBe(true);
    expect(figure?.hasAttribute("data-source")).toBe(false);
    expect(figure?.textContent).toContain("remote content");
    expect(figure?.querySelector("code")?.textContent).toContain("A@{ img:");

    const allowed = await renderDocument(container, source, ctx);
    expect(allowed.remoteBlocked).toBe(0);
    expect(container.querySelector("figure.diagram")?.getAttribute("data-source")).toContain("A@{ img:");
  });

  it("counts withheld remote images for the banner", async () => {
    const container = document.createElement("div");
    const result = await renderDocument(container, "![](https://t/a.png) ![](b.png)\n", { ...ctx, allowRemoteImages: false });
    expect(result.remoteBlocked).toBe(1);
    expect(container.querySelectorAll("img[data-blocked-src]").length).toBe(1);
  });

  it("uses the file name when there is no h1", async () => {
    const container = document.createElement("div");
    const result = await renderDocument(container, "just text", ctx);
    expect(result.title).toBeNull();
  });
});


describe("diagramReferencesRemote", () => {
  it("flags the image shape and CSS that fetches, not ordinary diagrams", () => {
    expect(diagramReferencesRemote('flowchart TD\n A@{ img: "https://t/x.png" }')).toBe(true);
    expect(diagramReferencesRemote("%%{init: {'themeCSS': '.x{background:url(https://t/x.png)}'}}%%\ngraph TD; A-->B")).toBe(true);
    expect(diagramReferencesRemote("%%{init: {'themeCSS': '@import \"https://t/x.css\"'}}%%\ngraph TD; A-->B")).toBe(true);
    expect(diagramReferencesRemote("graph TD; A-->B")).toBe(false);
    expect(diagramReferencesRemote("sequenceDiagram\n Alice->>Bob: see https://example.com")).toBe(false);
  });

});

describe("front matter", () => {
  it("shows front matter as a collapsed panel instead of a rule and a heading", async () => {
    document.body.innerHTML = "<article></article>";
    const article = document.querySelector("article") as HTMLElement;
    const result = await renderDocument(article, "---\ntitle: \"Hello\"\ntags:\n  - a\n  - b\n---\n\n# Hello\n", ctx);
    const panel = article.querySelector("details.frontmatter");
    expect(panel).not.toBeNull();
    expect(article.firstElementChild).toBe(panel);
    expect(panel?.querySelector("summary")?.textContent).toBe("YAML front matter · title: \"Hello\" · 1 more");
    expect(Array.from(panel?.querySelectorAll("dt") ?? []).map((e) => e.textContent)).toEqual(["title", "tags"]);
    expect(article.querySelector("hr")).toBeNull();
    expect(article.querySelector("h2")).toBeNull();
    expect(result.title).toBe("Hello");
  });

  it("names the tab after the front matter title when there is no h1", async () => {
    document.body.innerHTML = "<article></article>";
    const article = document.querySelector("article") as HTMLElement;
    const result = await renderDocument(article, "+++\ntitle = 'From TOML'\n+++\n\ntext\n", ctx);
    expect(result.title).toBe("From TOML");
    expect(article.querySelector("p")?.textContent).toBe("text");
  });
});
