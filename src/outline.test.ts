// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

import { describe, expect, it } from "vitest";

import { headingsFromMarkdown } from "./outline";

describe("headingsFromMarkdown", () => {
  it("collects ATX headings with levels and line numbers", () => {
    const h = headingsFromMarkdown("# One\n\ntext\n\n## Two ##\n### Three");
    expect(h).toEqual([
      { level: 1, text: "One", line: 1 },
      { level: 2, text: "Two", line: 5 },
      { level: 3, text: "Three", line: 6 },
    ]);
  });

  it("ignores headings inside fenced code", () => {
    const h = headingsFromMarkdown("# Real\n```\n# not a heading\n```\n~~~sh\n## nope\n~~~\n## Also real");
    expect(h.map((x) => x.text)).toEqual(["Real", "Also real"]);
  });

  it("requires a space after the hashes", () => {
    expect(headingsFromMarkdown("#hashtag\n#  spaced")).toEqual([{ level: 1, text: "spaced", line: 2 }]);
  });
});
