// SPDX-License-Identifier: LicenseRef-Proprietary
// Copyright (c) 2026 Gailleur Labs. All rights reserved.

import rehypeRaw from "rehype-raw";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

import { sanitizeHtml } from "./sanitize";

export interface RenderContext {
  /** Directory of the document; relative images resolve against it. */
  dir: string;
  allowRemoteImages: boolean;
  /** Turns an absolute filesystem path into a URL the webview may load. */
  assetUrl: (path: string) => string;
  theme: () => "light" | "dark";
}

export interface RenderResult {
  /** Text of the first `h1`, if any. */
  title: string | null;
}

const EXTERNAL = /^(https?:|mailto:|tel:)/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const MARKDOWN_FILE = /\.(md|markdown|mdown|mkd)$/i;

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeSlug)
  .use(rehypeStringify);

export async function markdownToHtml(markdown: string): Promise<string> {
  const file = await processor.process(markdown);
  return String(file);
}

/**
 * Resolves a document-relative reference to an absolute filesystem path, or
 * returns null when the reference is absolute, external, or an anchor.
 */
export function resolveRelative(dir: string, href: string): string | null {
  if (!href || HAS_SCHEME.test(href) || href.startsWith("#") || href.startsWith("/") || href.startsWith("\\")) {
    return null;
  }
  const bare = href.split("#")[0]?.split("?")[0] ?? "";
  if (!bare) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(bare);
  } catch {
    return null;
  }
  const sep = dir.includes("\\") ? "\\" : "/";
  const trimmedDir = dir.endsWith(sep) ? dir.slice(0, -1) : dir;
  return trimmedDir + sep + decoded.replace(/\//g, sep);
}

export function isExternalHref(href: string): boolean {
  return EXTERNAL.test(href);
}

export function isMarkdownHref(href: string): boolean {
  return MARKDOWN_FILE.test(href.split("#")[0]?.split("?")[0] ?? "");
}

function resolveImages(root: HTMLElement, ctx: RenderContext): void {
  for (const img of root.querySelectorAll("img")) {
    img.loading = "lazy";
    img.decoding = "async";
    const src = img.getAttribute("src");
    if (!src) continue;
    const resolved = resolveRelative(ctx.dir, src);
    if (resolved) {
      img.setAttribute("src", ctx.assetUrl(resolved));
    }
  }
}

function markLinks(root: HTMLElement): void {
  for (const anchor of root.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href") ?? "";
    if (isExternalHref(href)) {
      anchor.classList.add("link--external");
      anchor.setAttribute("title", href);
    }
  }
}

function disableCheckboxes(root: HTMLElement): void {
  for (const box of root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
    box.disabled = true;
    box.tabIndex = -1;
  }
}

async function renderMath(root: HTMLElement): Promise<void> {
  if (!/\$|\\\(|\\\[/.test(root.textContent ?? "")) return;
  const { default: renderMathInElement } = await import("katex/contrib/auto-render");
  renderMathInElement(root, {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "\\[", right: "\\]", display: true },
      { left: "\\(", right: "\\)", display: false },
      { left: "$", right: "$", display: false },
    ],
    ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code", "option"],
    ignoredClasses: ["diagram"],
    throwOnError: false,
  });
}

function isMermaidBlock(code: Element): boolean {
  return /\b(language-mermaid|mermaid)\b/.test(code.className);
}

function setDiagramFallback(figure: HTMLElement, source: string, message: string): void {
  figure.classList.add("diagram--error");
  const status = document.createElement("p");
  status.className = "diagram__status";
  status.textContent = message;
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.className = "language-mermaid";
  code.textContent = source;
  pre.appendChild(code);
  figure.replaceChildren(status, pre);
}

let diagramGeneration = 0;

/**
 * Renders every `figure.diagram[data-source]` in `root`. Safe to call again
 * (e.g. after a theme change); a newer call supersedes older in-flight ones.
 */
export async function renderDiagrams(root: HTMLElement, theme: "light" | "dark"): Promise<void> {
  const figures = Array.from(root.querySelectorAll<HTMLElement>("figure.diagram[data-source]"));
  if (figures.length === 0) return;

  const generation = ++diagramGeneration;
  const mermaid = (await import("mermaid")).default;
  if (generation !== diagramGeneration) return;

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: theme === "dark" ? "dark" : "default",
    flowchart: { htmlLabels: false },
    fontFamily: "inherit",
  });

  await Promise.all(
    figures.map(async (figure, index) => {
      const source = figure.dataset["source"] ?? "";
      try {
        const { svg } = await mermaid.render(`mdwisp-diagram-${generation}-${index}`, source);
        if (generation !== diagramGeneration) return;
        const img = document.createElement("img");
        img.className = "diagram__image";
        img.alt = "Diagram";
        img.decoding = "async";
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        figure.classList.remove("diagram--error");
        figure.replaceChildren(img);
      } catch {
        if (generation !== diagramGeneration) return;
        setDiagramFallback(figure, source, "Could not render diagram.");
      }
    }),
  );
}

function collectDiagrams(root: HTMLElement): void {
  for (const code of Array.from(root.querySelectorAll("pre > code")).filter(isMermaidBlock)) {
    const pre = code.parentElement;
    if (!pre) continue;
    const figure = document.createElement("figure");
    figure.className = "diagram";
    figure.dataset["source"] = code.textContent ?? "";
    const status = document.createElement("p");
    status.className = "diagram__status";
    status.textContent = "Rendering diagram…";
    figure.appendChild(status);
    pre.replaceWith(figure);
  }
}

function addCopyControls(root: HTMLElement): void {
  for (const code of root.querySelectorAll("pre > code")) {
    const pre = code.parentElement;
    if (!pre) continue;
    pre.classList.add("code");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "code__copy";
    button.dataset["state"] = "ready";
    button.setAttribute("aria-label", "Copy code");
    button.textContent = "copy";
    pre.prepend(button);
  }
}

/**
 * Renders `markdown` into `container`. The container's previous content is
 * replaced. Interactive behaviour (copy, links) is handled by delegated
 * listeners installed once by the caller, so the DOM here carries no handlers.
 */
export async function renderDocument(
  container: HTMLElement,
  markdown: string,
  ctx: RenderContext,
): Promise<RenderResult> {
  const html = sanitizeHtml(await markdownToHtml(markdown), { allowRemoteImages: ctx.allowRemoteImages });
  container.innerHTML = html || "<p></p>";

  resolveImages(container, ctx);
  markLinks(container);
  disableCheckboxes(container);
  collectDiagrams(container);
  addCopyControls(container);
  await renderMath(container);
  void renderDiagrams(container, ctx.theme());

  const heading = container.querySelector("h1");
  const title = heading?.textContent?.trim() || null;
  return { title };
}
