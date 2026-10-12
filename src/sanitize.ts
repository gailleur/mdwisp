// SPDX-License-Identifier: LicenseRef-Proprietary
// Copyright (c) 2026 Gailleur. All rights reserved.

import DOMPurify from "dompurify";

export interface SanitizeOptions {
  /** When false, `http(s)` image sources are removed and kept in `data-blocked-src`. */
  allowRemoteImages: boolean;
}

// Schemes a document may link to, plus relative paths. `file:` and
// `javascript:` are never matched.
const ALLOWED_URI = /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

// Inline CSS that could make the browser fetch something or run legacy code.
const DANGEROUS_STYLE = /url\s*\(|@import|expression\s*\(|behavior\s*:|-moz-binding/i;

const REMOTE = /^\s*https?:/i;

const purifier = DOMPurify();

purifier.addHook("uponSanitizeAttribute", (_node, data) => {
  if (data.attrName === "style" && DANGEROUS_STYLE.test(data.attrValue)) {
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

export function sanitizeHtml(html: string, options: SanitizeOptions): string {
  const blockRemote = !options.allowRemoteImages;

  const hook = (node: Element) => {
    if (node.tagName !== "IMG") return;
    node.removeAttribute("srcset");
    const src = node.getAttribute("src") ?? "";
    if (blockRemote && REMOTE.test(src)) {
      node.removeAttribute("src");
      node.setAttribute("data-blocked-src", src);
    }
  };

  purifier.addHook("afterSanitizeAttributes", hook);
  try {
    return purifier.sanitize(html, {
      USE_PROFILES: { html: true },
      ALLOWED_URI_REGEXP: ALLOWED_URI,
      ALLOW_UNKNOWN_PROTOCOLS: false,
      FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "textarea", "select", "button", "link", "meta", "base"],
      FORBID_ATTR: ["srcdoc", "formaction", "action", "ping"],
      ADD_ATTR: ["disabled"],
    });
  } finally {
    purifier.removeHook("afterSanitizeAttributes", hook);
  }
}
