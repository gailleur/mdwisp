// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

import DOMPurify from "dompurify";

export interface SanitizeOptions {
  /**
   * When false, remote image sources are removed; an `img` keeps its address
   * in `data-blocked-src` so the document can offer to load it later.
   */
  allowRemoteImages: boolean;
}

export interface SanitizeResult {
  html: string;
  /** How many remote images were withheld. */
  remoteBlocked: number;
}

// Schemes a document may link to, plus relative paths. `file:` and
// `javascript:` are never matched.
const ALLOWED_URI = /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

// A reference the webview would fetch from somewhere other than the
// document's folder: any scheme, or a protocol-relative `//host`, which the
// Windows origin would turn into http. Inline `data:` and the app's own
// asset protocol (`asset:`, `http://asset.localhost` on Windows) stay local.
const HAS_SCHEME_OR_HOST = /^\s*(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const STAYS_LOCAL = /^\s*(?:data:|asset:|https?:\/\/asset\.localhost(?:[/:?#]|$))/i;

/** True when loading `ref` would make a network request. */
export function isRemoteRef(ref: string): boolean {
  return HAS_SCHEME_OR_HOST.test(ref) && !STAYS_LOCAL.test(ref);
}

// Elements a Markdown document has no use for and whose own attributes make
// the browser fetch: `source srcset`, `video poster`, `track src`.
const MEDIA_TAGS = ["picture", "source", "video", "audio", "track"];

// Attributes that fetch an image without being an `img src`.
const FETCHING_ATTRS = ["srcset", "poster", "background"];

// Inline CSS is kept only when every function it calls is one of these. A
// `url()`, `image-set()`, `image()`, `element()` or `paint()` would fetch,
// and anything unknown is treated the same way.
const SAFE_CSS_FUNCTIONS = new Set([
  "rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch", "color", "color-mix",
  "calc", "min", "max", "clamp", "var", "env",
  "linear-gradient", "radial-gradient", "conic-gradient",
  "repeating-linear-gradient", "repeating-radial-gradient", "repeating-conic-gradient",
  "rotate", "scale", "scalex", "scaley", "translate", "translatex", "translatey", "skew", "skewx", "skewy", "matrix",
  "cubic-bezier", "steps", "counter", "counters",
]);
const DANGEROUS_CSS = /@import|expression\s*\(|behavior\s*:|-moz-binding/i;
const CSS_FUNCTION = /([a-z-]+)\s*\(/gi;

/**
 * Decodes what a CSS tokenizer would before it recognises a function name:
 * comments vanish and `\72` or `\r` become the character they name, so
 * `u\72l(` is seen as the `url(` it is.
 */
function decodeCss(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (_, hex: string) => {
      const point = Number.parseInt(hex, 16);
      return String.fromCodePoint(point > 0 && point <= 0x10ffff ? point : 0xfffd);
    })
    .replace(/\\([\s\S])/g, "$1");
}

/** True when an inline style can neither fetch nor run anything. */
export function isSafeStyle(raw: string): boolean {
  const value = decodeCss(raw);
  if (DANGEROUS_CSS.test(value)) return false;
  for (const match of value.matchAll(CSS_FUNCTION)) {
    const name = (match[1] ?? "").toLowerCase().replace(/^-(?:webkit|moz|ms|o)-/, "");
    if (!SAFE_CSS_FUNCTIONS.has(name)) return false;
  }
  return true;
}

const purifier = DOMPurify();

purifier.addHook("uponSanitizeAttribute", (_node, data) => {
  if (data.attrName === "style" && !isSafeStyle(data.attrValue)) {
    data.keepAttr = false;
  }
});

purifier.addHook("uponSanitizeElement", (node, data) => {
  // Only task-list checkboxes survive, and only as inert controls.
  if (data.tagName === "input") {
    const el = node as Element;
    if (el.getAttribute("type") !== "checkbox") {
      el.parentNode?.removeChild(el);
      return;
    }
    el.setAttribute("disabled", "");
  }
});

/**
 * Sanitises document HTML. Script, style, frames, forms and media elements
 * never survive; neither does an inline style that could fetch. Remote
 * images are kept only when `allowRemoteImages` is set.
 */
export function sanitize(html: string, options: SanitizeOptions): SanitizeResult {
  const blockRemote = !options.allowRemoteImages;
  let remoteBlocked = 0;

  const hook = (node: Element) => {
    if (node.tagName !== "IMG") return;
    const src = node.getAttribute("src") ?? "";
    if (blockRemote && isRemoteRef(src)) {
      node.removeAttribute("src");
      node.setAttribute("data-blocked-src", src);
      remoteBlocked += 1;
    }
  };

  purifier.addHook("afterSanitizeAttributes", hook);
  try {
    const clean = purifier.sanitize(html, {
      USE_PROFILES: { html: true },
      ALLOWED_URI_REGEXP: ALLOWED_URI,
      ALLOW_UNKNOWN_PROTOCOLS: false,
      FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "textarea", "select", "button", "link", "meta", "base", ...MEDIA_TAGS],
      FORBID_ATTR: ["srcdoc", "formaction", "action", "ping", ...FETCHING_ATTRS],
      ADD_ATTR: ["disabled"],
    });
    return { html: clean, remoteBlocked };
  } finally {
    purifier.removeHook("afterSanitizeAttributes", hook);
  }
}

export function sanitizeHtml(html: string, options: SanitizeOptions): string {
  return sanitize(html, options).html;
}
