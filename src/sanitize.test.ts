// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

import { describe, expect, it } from "vitest";

import { isRemoteRef, isSafeStyle, sanitize, sanitizeHtml } from "./sanitize";

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

  it("blocks protocol-relative sources and keeps inline data images", () => {
    const out = sanitizeHtml('<img src="//t/px.gif"><img src="data:image/gif;base64,R0lGOD">', block);
    expect(out).toContain('data-blocked-src="//t/px.gif"');
    expect(out).toContain('src="data:image/gif;base64,R0lGOD"');
  });

  it("counts the remote images it withheld", () => {
    expect(sanitize('<img src="https://t/a.png"><img src="https://t/b.png"><img src="c.png">', block).remoteBlocked).toBe(2);
    expect(sanitize('<img src="https://t/a.png">', allow).remoteBlocked).toBe(0);
  });

  it("removes media elements and image-fetching attributes whatever the setting", () => {
    for (const options of [allow, block]) {
      const out = sanitizeHtml(
        '<picture><source srcset="https://t/x.png"><img src="x.png"></picture>' +
          '<video poster="https://t/x.png" src="https://t/x.mp4"></video><audio src="https://t/x.mp3"></audio>' +
          '<table background="https://t/x.png"><tr><td background="https://t/y.png">x</td></tr></table>' +
          '<img src="x.png" srcset="https://t/x.png 2x">',
        options,
      );
      expect(out).not.toMatch(/picture|source|video|audio|poster|background|srcset/);
      expect(out).toContain("<td>x</td>");
    }
  });

  it("drops inline styles that fetch through CSS escapes, comments or image-set", () => {
    const cases = [
      "background:u\\72l(https://t/x.png)",
      "background:u\\00072 rl(https://t/x.png)",
      "background:u/**/rl(https://t/x.png)",
      "background:URL(https://t/x.png)",
      "background:image-set('https://t/x.png' 1x)",
      "background:-webkit-image-set(url(https://t/x.png) 1x)",
      "background:image('https://t/x.png')",
      "content:url(https://t/x.png)",
      "cursor:url(https://t/x.cur), auto",
      "behavior:url(x.htc)",
    ];
    for (const style of cases) {
      expect(sanitizeHtml(`<p style="${style}">a</p>`, allow), style).not.toContain("style=");
      expect(isSafeStyle(style), style).toBe(false);
    }
    const kept = sanitizeHtml('<p style="color:rgb(1,2,3);width:calc(100% - 2px);background:linear-gradient(red, blue);transform:rotate(1deg)">a</p>', allow);
    expect(kept).toContain("style=");
    expect(kept).toContain("linear-gradient");
  });

  it("knows which references would fetch", () => {
    expect(isRemoteRef("https://t/x.png")).toBe(true);
    expect(isRemoteRef("http://t/x.png")).toBe(true);
    expect(isRemoteRef("//t/x.png")).toBe(true);
    expect(isRemoteRef("  HTTPS://t/x.png")).toBe(true);
    expect(isRemoteRef("ftp://t/x.png")).toBe(true);
    expect(isRemoteRef("data:image/gif;base64,AA")).toBe(false);
    expect(isRemoteRef("asset://localhost/docs/pic.png")).toBe(false);
    expect(isRemoteRef("http://asset.localhost/C:/docs/pic.png")).toBe(false);
    expect(isRemoteRef("http://asset.localhost.evil/x.png")).toBe(true);
    expect(isRemoteRef("pic.png")).toBe(false);
    expect(isRemoteRef("./a/b.png")).toBe(false);
    expect(isRemoteRef("/abs/b.png")).toBe(false);
    expect(isRemoteRef("")).toBe(false);
  });
});
