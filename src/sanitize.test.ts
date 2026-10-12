// SPDX-License-Identifier: LicenseRef-Proprietary
// Copyright (c) 2026 Gailleur Labs. All rights reserved.

import { describe, expect, it } from "vitest";

import { sanitizeHtml } from "./sanitize";

const allow = { allowRemoteImages: true };
const block = { allowRemoteImages: false };

describe("sanitizeHtml", () => {
  it("removes scripts and inline handlers", () => {
    const out = sanitizeHtml('<p onclick="x()">hi</p><script>alert(1)</script><img src="a.png" onerror="alert(1)">', allow);
    expect(out).not.toMatch(/script|onclick|onerror/);
    expect(out).toContain('<img src="a.png">');
  });

  it("drops javascript: and file: links but keeps http and relative", () => {
    const out = sanitizeHtml(
      '<a href="javascript:alert(1)">a</a><a href="file:///etc/passwd">b</a><a href="https://x.y">c</a><a href="other.md">d</a>',
      allow,
    );
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("file:");
    expect(out).toContain('href="https://x.y"');
    expect(out).toContain('href="other.md"');
  });

  it("removes frames, objects, forms and styles", () => {
    const out = sanitizeHtml('<iframe src="https://x"></iframe><object data="x"></object><form><input type="text"></form><style>p{}</style>', allow);
    expect(out).toBe("");
  });

  it("strips style attributes that could fetch", () => {
    const out = sanitizeHtml('<p style="color:red">a</p><p style="background:url(https://t/x.png)">b</p>', allow);
    expect(out).toContain('style="color:red"');
    expect(out).not.toContain("url(");
  });

  it("keeps task checkboxes inert and removes other inputs", () => {
    const out = sanitizeHtml('<input type="checkbox" checked><input type="text" value="x">', allow);
    expect(out).toContain('type="checkbox"');
    expect(out).toContain("disabled");
    expect(out).not.toContain('type="text"');
  });

  it("blocks remote images when asked", () => {
    const out = sanitizeHtml('<img src="https://t/px.gif"><img src="local.png">', block);
    expect(out).not.toContain(' src="https://t/px.gif"');
    expect(out).toContain('<img data-blocked-src="https://t/px.gif">');
    expect(out).toContain('src="local.png"');
  });

  it("always drops srcset", () => {
    const out = sanitizeHtml('<img src="a.png" srcset="https://t/a.png 2x">', allow);
    expect(out).not.toContain("srcset");
  });
});
