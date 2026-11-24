// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

import { beforeEach, describe, expect, it } from "vitest";

import { RECENT_KEY, RECENT_LIMIT, pushRecent, readRecent, recentLabels, withoutRecent, writeRecent } from "./recent";

describe("recent documents", () => {
  beforeEach(() => localStorage.clear());

  it("moves a path to the front and keeps the list within the limit", () => {
    let list: string[] = [];
    for (let i = 0; i < RECENT_LIMIT + 3; i++) list = pushRecent(list, `/d/${i}.md`);
    expect(list.length).toBe(RECENT_LIMIT);
    expect(list[0]).toBe(`/d/${RECENT_LIMIT + 2}.md`);
    list = pushRecent(list, "/d/5.md");
    expect(list[0]).toBe("/d/5.md");
    expect(list.filter((p) => p === "/d/5.md").length).toBe(1);
    expect(withoutRecent(list, "/d/5.md")).not.toContain("/d/5.md");
  });

  it("round-trips through storage and ignores rubbish", () => {
    writeRecent(["/a/x.md", "/b/y.md"]);
    expect(readRecent()).toEqual(["/a/x.md", "/b/y.md"]);
    writeRecent([]);
    expect(localStorage.getItem(RECENT_KEY)).toBeNull();
    localStorage.setItem(RECENT_KEY, '{"not":"a list"}');
    expect(readRecent()).toEqual([]);
    localStorage.setItem(RECENT_KEY, '["/ok.md", 3, ""]');
    expect(readRecent()).toEqual(["/ok.md"]);
  });

  it("labels entries by name, adding the folder only when names collide", () => {
    expect(recentLabels(["/docs/a/README.md", "/docs/b/README.md", "/docs/notes.md", "C:\\w\\spec.md"])).toEqual([
      "README.md — a",
      "README.md — b",
      "notes.md",
      "spec.md",
    ]);
  });
});
