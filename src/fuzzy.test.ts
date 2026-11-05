// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

import { describe, expect, it } from "vitest";

import { fuzzyMatch } from "./fuzzy";

const score = (query: string, text: string) => fuzzyMatch(query, text)?.score ?? null;

describe("fuzzyMatch", () => {
  it("needs every letter of the query, in order", () => {
    expect(fuzzyMatch("abc", "a-b-c")).not.toBeNull();
    expect(fuzzyMatch("abc", "acb")).toBeNull();
    expect(fuzzyMatch("abcd", "abc")).toBeNull();
    expect(fuzzyMatch("", "anything")).toEqual({ score: 0, positions: [] });
  });

  it("ignores case and the spaces in the query", () => {
    expect(fuzzyMatch("OPEN fold", "Open Folder…")).not.toBeNull();
    expect(score("readme", "README.md")).toBe(score("README", "README.md"));
  });

  it("prefers word starts and runs over scattered letters", () => {
    expect(score("of", "Open Folder…")!).toBeGreaterThan(score("of", "Zoom Off")!);
    expect(score("spec", "docs/spec.md")!).toBeGreaterThan(score("spec", "samples/pieces.md")!);
    expect(score("note", "notes.md")!).toBeGreaterThan(score("note", "an-old-template.md")!);
    expect(score("qo", "quickOpen")!).toBeGreaterThan(score("qo", "quota")!);
  });

  it("prefers a match near the start", () => {
    expect(score("plan", "plan.md")!).toBeGreaterThan(score("plan", "archive-plan.md")!);
  });

  it("reports which letters matched, choosing the best reading", () => {
    expect(fuzzyMatch("of", "Open Folder…", true)?.positions).toEqual([0, 5]);
    expect(fuzzyMatch("spec", "docs/spec.md", true)?.positions).toEqual([5, 6, 7, 8]);
    // Initials read as an acronym; otherwise a later run beats scattered letters.
    expect(fuzzyMatch("md", "memo-draft.md", true)?.positions).toEqual([0, 5]);
    expect(fuzzyMatch("md", "amend-old.md", true)?.positions).toEqual([10, 11]);
  });

  it("copes with long paths", () => {
    const path = `${"folder/".repeat(40)}target-note.md`;
    const match = fuzzyMatch("targetnote", path, true);
    expect(match?.positions.length).toBe(10);
    expect(path.slice(match!.positions[0]!, match!.positions[0]! + 6)).toBe("target");
  });
});
